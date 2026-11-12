//! Native admission policy for supplier document downloads.
//!
//! This is intentionally separate from the general customer REST connector:
//! supplier adapters must provide their declared exact hostnames and cannot
//! opt into arbitrary URLs, redirects, private addresses, or unbounded files.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::{Duration, Instant};

use reqwest::header::{CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_TYPE, LOCATION};
use reqwest::{redirect::Policy, Client, Url};
use tauri::AppHandle;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_TIMEOUT: Duration = Duration::from_secs(120);
const DEFAULT_MAX_BYTES: usize = 25 * 1024 * 1024;
const HARD_MAX_BYTES: usize = 100 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

#[derive(Debug, Clone)]
pub(crate) struct NetworkAdmissionPolicy {
    /// Exact DNS hostnames declared by the selected provider surface.
    pub declared_hosts: Vec<String>,
    /// Exact media types accepted by this acquisition task.
    pub allowed_content_types: Vec<String>,
    pub timeout: Duration,
    pub max_bytes: usize,
    pub max_redirects: usize,
}

impl Default for NetworkAdmissionPolicy {
    fn default() -> Self {
        Self {
            declared_hosts: Vec::new(),
            allowed_content_types: vec![
                "application/pdf".into(),
                "application/octet-stream".into(),
            ],
            timeout: DEFAULT_TIMEOUT,
            max_bytes: DEFAULT_MAX_BYTES,
            max_redirects: MAX_REDIRECTS,
        }
    }
}

#[allow(dead_code)] // Consumed by V01-01.006 document persistence and V01-02 provider adapters.
#[derive(Debug)]
pub(crate) struct AdmittedDocument {
    pub filename: String,
    pub content_type: String,
    pub source_url: String,
    pub bytes: Vec<u8>,
}

#[allow(dead_code)] // Consumed by supplier adapter commands in the following V01 milestone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredSupplierDocument {
    pub filename: String,
    pub content_type: String,
    pub source_url: String,
    pub sha256: String,
    pub byte_size: u64,
    pub relative_path: String,
    pub deduplicated: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum AdmissionError {
    InvalidPolicy,
    InvalidUrl,
    HostNotDeclared,
    UnsafeAddress,
    DnsFailure,
    Timeout,
    RedirectDenied,
    TooManyRedirects,
    RequestFailed,
    InvalidContentType,
    FileTooLarge,
    InvalidSignature,
}

fn normalize_declared_host(host: &str) -> Result<String, AdmissionError> {
    if host.trim() != host || host.is_empty() || host.contains(['/', '@', ':', '?', '#']) {
        return Err(AdmissionError::InvalidPolicy);
    }
    let parsed =
        Url::parse(&format!("https://{host}/")).map_err(|_| AdmissionError::InvalidPolicy)?;
    let normalized = parsed
        .host_str()
        .ok_or(AdmissionError::InvalidPolicy)?
        .to_ascii_lowercase();
    let valid_labels = normalized.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label.as_bytes()[0].is_ascii_alphanumeric()
            && label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    });
    if !valid_labels
        || !normalized.contains('.')
        || normalized == "localhost"
        || normalized.parse::<IpAddr>().is_ok()
    {
        return Err(AdmissionError::InvalidPolicy);
    }
    Ok(normalized)
}

fn validate_policy(policy: &NetworkAdmissionPolicy) -> Result<Vec<String>, AdmissionError> {
    if policy.declared_hosts.is_empty()
        || policy.allowed_content_types.is_empty()
        || policy.max_bytes == 0
        || policy.max_bytes > HARD_MAX_BYTES
        || policy.timeout.is_zero()
        || policy.timeout > MAX_TIMEOUT
        || policy.max_redirects > MAX_REDIRECTS
    {
        return Err(AdmissionError::InvalidPolicy);
    }
    let mut hosts = Vec::with_capacity(policy.declared_hosts.len());
    for host in &policy.declared_hosts {
        let normalized = normalize_declared_host(host)?;
        if hosts.contains(&normalized) {
            return Err(AdmissionError::InvalidPolicy);
        }
        hosts.push(normalized);
    }
    Ok(hosts)
}

fn validate_url(url: &Url, allowed_hosts: &[String]) -> Result<(String, u16), AdmissionError> {
    if url.as_str().len() > 8_192
        || url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port().is_some_and(|port| port != 443)
    {
        return Err(AdmissionError::InvalidUrl);
    }
    let host = url
        .host_str()
        .ok_or(AdmissionError::InvalidUrl)?
        .to_ascii_lowercase();
    if host.parse::<IpAddr>().is_ok() || !allowed_hosts.iter().any(|allowed| allowed == &host) {
        return Err(AdmissionError::HostNotDeclared);
    }
    Ok((host, url.port().unwrap_or(443)))
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn in_v4_range(ip: Ipv4Addr, network: Ipv4Addr, prefix: u32) -> bool {
    let mask = if prefix == 0 {
        0
    } else {
        u32::MAX << (32 - prefix)
    };
    u32::from(ip) & mask == u32::from(network) & mask
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    if ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_multicast()
    {
        return false;
    }
    ![
        (Ipv4Addr::new(0, 0, 0, 0), 8),
        (Ipv4Addr::new(100, 64, 0, 0), 10),
        (Ipv4Addr::new(192, 0, 0, 0), 24),
        (Ipv4Addr::new(192, 0, 2, 0), 24),
        (Ipv4Addr::new(192, 88, 99, 0), 24),
        (Ipv4Addr::new(198, 18, 0, 0), 15),
        (Ipv4Addr::new(198, 51, 100, 0), 24),
        (Ipv4Addr::new(203, 0, 113, 0), 24),
        (Ipv4Addr::new(240, 0, 0, 0), 4),
    ]
    .iter()
    .any(|(network, prefix)| in_v4_range(ip, *network, *prefix))
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    let value = u128::from(ip);
    let global_unicast = value & (0b111_u128 << 125) == (0b001_u128 << 125); // 2000::/3
    let in_prefix = |network: Ipv6Addr, prefix: u32| {
        let mask = u128::MAX << (128 - prefix);
        value & mask == u128::from(network) & mask
    };
    let special_use = in_prefix(Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 23)
        || in_prefix(Ipv6Addr::new(0x2001, 0x0db8, 0, 0, 0, 0, 0, 0), 32)
        || in_prefix(Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16)
        || in_prefix(Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20);
    global_unicast && !special_use && !ip.is_multicast()
}

async fn resolve_public(
    host: &str,
    port: u16,
    remaining: Duration,
) -> Result<Vec<SocketAddr>, AdmissionError> {
    let lookup = tokio::net::lookup_host((host, port));
    let addresses = tokio::time::timeout(remaining, lookup)
        .await
        .map_err(|_| AdmissionError::Timeout)?
        .map_err(|_| AdmissionError::DnsFailure)?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(AdmissionError::DnsFailure);
    }
    if addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(AdmissionError::UnsafeAddress);
    }
    Ok(addresses)
}

fn safe_filename(raw: &str) -> String {
    let leaf = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    let mut result = String::with_capacity(leaf.len().min(160));
    for ch in leaf.chars().take(160) {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ' ') {
            result.push(ch);
        } else {
            result.push('_');
        }
    }
    let trimmed = result.trim().trim_matches('.');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "supplier-document.pdf".to_string()
    } else {
        let device_name = trimmed
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if matches!(device_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || device_name
                .strip_prefix("COM")
                .is_some_and(|n| n.len() == 1 && matches!(n.as_bytes()[0], b'1'..=b'9'))
            || device_name
                .strip_prefix("LPT")
                .is_some_and(|n| n.len() == 1 && matches!(n.as_bytes()[0], b'1'..=b'9'))
        {
            format!("_{trimmed}")
        } else {
            trimmed.to_string()
        }
    }
}

fn safe_source_url(url: &Url) -> String {
    let mut safe = url.clone();
    let keys = safe
        .query_pairs()
        .map(|(key, _)| key.into_owned())
        .collect::<Vec<_>>();
    {
        let mut pairs = safe.query_pairs_mut();
        pairs.clear();
        for key in keys {
            pairs.append_pair(&key, "[redacted]");
        }
    }
    safe.to_string()
}

fn response_filename(response: &reqwest::Response, url: &Url) -> String {
    if let Some(value) = response
        .headers()
        .get(CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(candidate) = value.split(';').find_map(|part| {
            let (key, value) = part.trim().split_once('=')?;
            (key.eq_ignore_ascii_case("filename") || key.eq_ignore_ascii_case("filename*"))
                .then(|| value.trim_matches(['"', '\'']))
        }) {
            return safe_filename(candidate);
        }
    }
    safe_filename(
        url.path_segments()
            .and_then(|mut segments| segments.next_back())
            .unwrap_or_default(),
    )
}

fn validate_pdf_content_type(
    content_type: &str,
    allowed: &[String],
) -> Result<String, AdmissionError> {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !allowed
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(&media_type))
    {
        return Err(AdmissionError::InvalidContentType);
    }
    if !matches!(
        media_type.as_str(),
        "application/pdf" | "application/octet-stream"
    ) {
        return Err(AdmissionError::InvalidContentType);
    }
    Ok(media_type)
}

fn validate_pdf_signature(bytes: &[u8]) -> Result<(), AdmissionError> {
    if bytes.starts_with(b"%PDF-") {
        Ok(())
    } else {
        Err(AdmissionError::InvalidSignature)
    }
}

/// Fetch a PDF using only exact hosts declared by the selected provider
/// surface. Every redirect is re-admitted and every DNS answer is checked
/// and pinned into a one-hop client to prevent rebinding between validation
/// and connect. Errors intentionally carry no URLs, headers, or response body.
#[allow(dead_code)]
pub(crate) async fn fetch_supplier_pdf(
    initial_url: &str,
    policy: &NetworkAdmissionPolicy,
) -> Result<AdmittedDocument, String> {
    fetch_with(initial_url, policy)
        .await
        .map_err(|_| "supplier document request was rejected or failed".to_string())
}

/// Complete the native, bounded download-to-blob path. PDF bytes stay inside
/// Rust and are dropped after successful content-addressed persistence; only
/// metadata needed for the immutable acquisition receipt is returned.
#[allow(dead_code)]
pub(crate) async fn fetch_and_store_supplier_pdf(
    app: &AppHandle,
    initial_url: &str,
    policy: &NetworkAdmissionPolicy,
) -> Result<StoredSupplierDocument, String> {
    let document = fetch_with(initial_url, policy)
        .await
        .map_err(|_| "supplier document request was rejected or failed".to_string())?;
    let data_root = crate::formulation_v2::project_data_dir(app, "data")?;
    let (filename, content_type, source_url) = (
        document.filename.clone(),
        document.content_type.clone(),
        document.source_url.clone(),
    );
    let stored = tauri::async_runtime::spawn_blocking(move || {
        crate::supplier_document_store::store_pdf_bytes(&data_root, &document.bytes, None)
    })
    .await
    .map_err(|_| "supplier document storage failed".to_string())??;
    Ok(StoredSupplierDocument {
        filename,
        content_type,
        source_url,
        sha256: stored.sha256,
        byte_size: stored.byte_size,
        relative_path: stored.relative_path,
        deduplicated: stored.deduplicated,
    })
}

async fn fetch_with(
    initial_url: &str,
    policy: &NetworkAdmissionPolicy,
) -> Result<AdmittedDocument, AdmissionError> {
    let allowed_hosts = validate_policy(policy)?;
    let mut current = Url::parse(initial_url).map_err(|_| AdmissionError::InvalidUrl)?;
    let started = Instant::now();
    let mut redirects = 0;

    loop {
        let remaining = policy
            .timeout
            .checked_sub(started.elapsed())
            .filter(|v| !v.is_zero())
            .ok_or(AdmissionError::Timeout)?;
        let (host, port) = validate_url(&current, &allowed_hosts)?;
        let addresses = resolve_public(&host, port, remaining).await?;
        let client = Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .timeout(remaining)
            .read_timeout(remaining)
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|_| AdmissionError::RequestFailed)?;
        let mut response = client
            .get(current.clone())
            .send()
            .await
            .map_err(|_| AdmissionError::RequestFailed)?;

        if response.status().is_redirection() {
            if redirects >= policy.max_redirects {
                return Err(AdmissionError::TooManyRedirects);
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or(AdmissionError::RedirectDenied)?;
            let next = current
                .join(location)
                .map_err(|_| AdmissionError::RedirectDenied)?;
            validate_url(&next, &allowed_hosts).map_err(|_| AdmissionError::RedirectDenied)?;
            redirects += 1;
            current = next;
            continue;
        }
        if !response.status().is_success() {
            return Err(AdmissionError::RequestFailed);
        }

        let raw_content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .ok_or(AdmissionError::InvalidContentType)?;
        let content_type =
            validate_pdf_content_type(raw_content_type, &policy.allowed_content_types)?;
        if response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok())
            .is_some_and(|length| length > policy.max_bytes)
        {
            return Err(AdmissionError::FileTooLarge);
        }
        let filename = response_filename(&response, &current);
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AdmissionError::RequestFailed)?
        {
            if bytes.len().saturating_add(chunk.len()) > policy.max_bytes {
                return Err(AdmissionError::FileTooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        validate_pdf_signature(&bytes)?;
        return Ok(AdmittedDocument {
            filename,
            content_type,
            source_url: safe_source_url(&current),
            bytes,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> NetworkAdmissionPolicy {
        NetworkAdmissionPolicy {
            declared_hosts: vec!["supplier.example".into()],
            ..Default::default()
        }
    }

    #[test]
    fn only_https_urls_on_an_exact_declared_dns_host_are_admitted() {
        let allowed = validate_policy(&policy()).unwrap();
        assert!(validate_url(
            &Url::parse("https://supplier.example/sds.pdf").unwrap(),
            &allowed
        )
        .is_ok());
        assert_eq!(
            validate_url(
                &Url::parse("http://supplier.example/sds.pdf").unwrap(),
                &allowed
            ),
            Err(AdmissionError::InvalidUrl)
        );
        assert_eq!(
            validate_url(
                &Url::parse("https://other.example/sds.pdf").unwrap(),
                &allowed
            ),
            Err(AdmissionError::HostNotDeclared)
        );
        assert_eq!(
            validate_url(
                &Url::parse("https://supplier.example.attacker.test/sds.pdf").unwrap(),
                &allowed
            ),
            Err(AdmissionError::HostNotDeclared)
        );
        assert_eq!(
            validate_url(
                &Url::parse("https://user:pass@supplier.example/sds.pdf").unwrap(),
                &allowed
            ),
            Err(AdmissionError::InvalidUrl)
        );
        assert_eq!(
            validate_url(&Url::parse("https://127.0.0.1/sds.pdf").unwrap(), &allowed),
            Err(AdmissionError::HostNotDeclared)
        );
    }

    #[test]
    fn declared_hostnames_and_download_limits_are_validated() {
        let mut invalid = policy();
        invalid.declared_hosts = vec!["localhost".into()];
        assert_eq!(
            validate_policy(&invalid),
            Err(AdmissionError::InvalidPolicy)
        );
        let mut duplicate = policy();
        duplicate.declared_hosts.push("SUPPLIER.EXAMPLE".into());
        assert_eq!(
            validate_policy(&duplicate),
            Err(AdmissionError::InvalidPolicy)
        );
        let mut too_large = policy();
        too_large.max_bytes = HARD_MAX_BYTES + 1;
        assert_eq!(
            validate_policy(&too_large),
            Err(AdmissionError::InvalidPolicy)
        );
        let mut too_many_redirects = policy();
        too_many_redirects.max_redirects = MAX_REDIRECTS + 1;
        assert_eq!(
            validate_policy(&too_many_redirects),
            Err(AdmissionError::InvalidPolicy)
        );
    }

    #[test]
    fn blocks_private_reserved_and_mapped_private_addresses() {
        for address in [
            "10.0.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "172.16.0.1",
            "192.168.1.1",
            "100.64.0.1",
            "198.18.0.1",
            "203.0.113.2",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "2002::1",
            "3fff::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(
                !is_public_ip(address.parse().unwrap()),
                "{address} must be blocked"
            );
        }
        assert!(is_public_ip("8.8.8.8".parse().unwrap()));
        assert!(is_public_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn safe_filenames_strip_paths_controls_and_reserved_separators() {
        assert_eq!(safe_filename("../../SDS: draft?.pdf"), "SDS_ draft_.pdf");
        assert_eq!(safe_filename("../.."), "supplier-document.pdf");
        assert_eq!(safe_filename("CON.pdf"), "_CON.pdf");
        assert!(!safe_filename("C:\\temp\\file.pdf").contains('\\'));
    }

    #[test]
    fn content_type_and_pdf_signature_must_both_match() {
        let allowed = [
            "application/pdf".to_string(),
            "application/octet-stream".to_string(),
        ];
        assert_eq!(
            validate_pdf_content_type("application/pdf; version=1.7", &allowed),
            Ok("application/pdf".into())
        );
        assert!(validate_pdf_content_type("text/html", &allowed).is_err());
        assert!(validate_pdf_signature(b"%PDF-1.7\n").is_ok());
        assert_eq!(
            validate_pdf_signature(b"<html>login page</html>"),
            Err(AdmissionError::InvalidSignature)
        );
    }

    #[test]
    fn provenance_url_redacts_every_query_value() {
        let url =
            Url::parse("https://supplier.example/docs/123?product=ABC&token=private").unwrap();
        let safe = safe_source_url(&url);
        assert!(safe.contains("product=%5Bredacted%5D"));
        assert!(safe.contains("token=%5Bredacted%5D"));
        assert!(!safe.contains("ABC"));
        assert!(!safe.contains("private"));
    }

    #[test]
    fn redirect_targets_are_subject_to_the_same_exact_host_and_https_rules() {
        let allowed = validate_policy(&policy()).unwrap();
        let original = Url::parse("https://supplier.example/sds.pdf").unwrap();
        let same_host = original.join("/documents/1.pdf").unwrap();
        let downgrade = original
            .join("http://supplier.example/document.pdf")
            .unwrap();
        let external = original
            .join("https://attacker.example/document.pdf")
            .unwrap();
        assert!(validate_url(&same_host, &allowed).is_ok());
        assert_eq!(
            validate_url(&downgrade, &allowed),
            Err(AdmissionError::InvalidUrl)
        );
        assert_eq!(
            validate_url(&external, &allowed),
            Err(AdmissionError::HostNotDeclared)
        );
    }
}
