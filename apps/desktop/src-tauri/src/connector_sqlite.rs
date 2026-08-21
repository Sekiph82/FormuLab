// Connector Management frontend — the minimum production-safe DATABASE
// adapter (Section 6/7 of the governing brief): SQLite, read-only, opened
// directly through `rusqlite` (already a dependency of this crate, bundled
// — no external SQLite install required). This is the ONLY real
// `DatabaseAdapter` implementation wired into a customer connection;
// `sqliteTestAdapter.ts` (sql.js/WASM, in-memory) remains test/acceptance
// infrastructure only, never touched by this module.
//
// Read-only, several ways: (1) the file is opened with
// `SQLITE_OPEN_READ_ONLY` — SQLite itself refuses any write at the driver
// level, not merely by convention. (2) every command here only ever
// issues `PRAGMA` introspection or a parameterized `SELECT` — no command
// exists (and none is registered in `lib.rs`) through which the frontend
// could request an INSERT/UPDATE/DELETE/DDL statement. (3) table/column
// identifiers are never taken from caller input and dropped directly into
// SQL text — every identifier is first verified against the real,
// server-side `sqlite_master`/`PRAGMA table_info` result for this exact
// database (a whitelist check), and even then is quoted with internal
// quotes doubled before being used in a query string. Only VALUES are
// ever parameter-bound.
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

fn open_readonly(path: &str) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Could not open \"{path}\" as a read-only SQLite database: {e}"))
}

/// Doubles any embedded `"` before wrapping in `"..."` — standard SQL
/// identifier quoting, applied only to identifiers already verified
/// against a real introspection result (never raw caller input alone).
fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqliteTableRef {
    pub table: String,
    pub kind: String,
}

fn list_tables_raw(conn: &Connection) -> Result<Vec<SqliteTableRef>, String> {
    let mut stmt = conn
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SqliteTableRef {
                table: row.get(0)?,
                kind: row.get::<_, String>(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn connector_sqlite_list_tables(path: String) -> Result<Vec<SqliteTableRef>, String> {
    let conn = open_readonly(&path)?;
    list_tables_raw(&conn)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqliteColumnMetadata {
    pub name: String,
    pub declared_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub primary_key_ordinal: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqliteForeignKeyMetadata {
    pub from_columns: Vec<String>,
    pub to_table: String,
    pub to_columns: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqliteEntityDescription {
    pub table: String,
    pub kind: String,
    pub columns: Vec<SqliteColumnMetadata>,
    pub foreign_keys: Vec<SqliteForeignKeyMetadata>,
}

fn describe_table_raw(conn: &Connection, table: &str) -> Result<SqliteEntityDescription, String> {
    let known = list_tables_raw(conn)?;
    let matched = known
        .iter()
        .find(|t| t.table == table)
        .ok_or_else(|| format!("\"{table}\" is not a real table/view in this database."))?;

    let quoted = quote_ident(table);

    // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
    // (`pk` is the 1-based composite-key ordinal, 0 when not part of the PK
    // — exactly the convention `DatabaseColumnMetadata.primaryKeyOrdinal`
    // already documents as SQLite's own).
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({quoted})"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(1)?;
            let declared_type: String = row.get(2)?;
            let notnull: i64 = row.get(3)?;
            let pk: i64 = row.get(5)?;
            Ok((name, declared_type, notnull, pk))
        })
        .map_err(|e| e.to_string())?;
    let mut columns = Vec::new();
    for r in rows {
        let (name, declared_type, notnull, pk) = r.map_err(|e| e.to_string())?;
        columns.push(SqliteColumnMetadata {
            name,
            declared_type,
            nullable: notnull == 0,
            is_primary_key: pk > 0,
            primary_key_ordinal: if pk > 0 { Some(pk as u32) } else { None },
        });
    }

    // PRAGMA foreign_key_list: id, seq, table, from, to, on_update, on_delete, match
    let mut fk_stmt = conn
        .prepare(&format!("PRAGMA foreign_key_list({quoted})"))
        .map_err(|e| e.to_string())?;
    let fk_rows = fk_stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let to_table: String = row.get(2)?;
            let from_col: String = row.get(3)?;
            let to_col: String = row.get(4)?;
            Ok((id, to_table, from_col, to_col))
        })
        .map_err(|e| e.to_string())?;
    let mut fk_groups: std::collections::BTreeMap<i64, (String, Vec<String>, Vec<String>)> = std::collections::BTreeMap::new();
    for r in fk_rows {
        let (id, to_table, from_col, to_col) = r.map_err(|e| e.to_string())?;
        let entry = fk_groups.entry(id).or_insert((to_table, Vec::new(), Vec::new()));
        entry.1.push(from_col);
        entry.2.push(to_col);
    }
    let foreign_keys = fk_groups
        .into_values()
        .map(|(to_table, from_columns, to_columns)| SqliteForeignKeyMetadata { from_columns, to_table, to_columns })
        .collect();

    Ok(SqliteEntityDescription {
        table: matched.table.clone(),
        kind: matched.kind.clone(),
        columns,
        foreign_keys,
    })
}

#[tauri::command]
pub fn connector_sqlite_describe_table(path: String, table: String) -> Result<SqliteEntityDescription, String> {
    let conn = open_readonly(&path)?;
    describe_table_raw(&conn, &table)
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SqliteFilterArg {
    pub column: String,
    pub op: String,
    pub value: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqlitePageResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub next_cursor: Option<String>,
}

/// A bounded, deterministic, parameterized `SELECT` — never a raw
/// caller-supplied query string. `table`/`columns`/`filter.column` are
/// each checked against `describe_table_raw()`'s real result before use;
/// only `filter.value` and the LIMIT/OFFSET bounds are ever bound as SQL
/// parameters.
#[tauri::command]
pub fn connector_sqlite_read_page(
    path: String,
    table: String,
    columns: Option<Vec<String>>,
    filter: Option<SqliteFilterArg>,
    page_size: i64,
    cursor: Option<String>,
) -> Result<SqlitePageResult, String> {
    if page_size <= 0 || page_size > 5000 {
        return Err("pageSize must be between 1 and 5000.".to_string());
    }
    let conn = open_readonly(&path)?;
    let description = describe_table_raw(&conn, &table)?;
    let known_columns: Vec<&str> = description.columns.iter().map(|c| c.name.as_str()).collect();

    let selected: Vec<&str> = match &columns {
        Some(cs) => {
            for c in cs {
                if !known_columns.contains(&c.as_str()) {
                    return Err(format!("\"{c}\" is not a real column on \"{table}\"."));
                }
            }
            cs.iter().map(|s| s.as_str()).collect()
        }
        None => known_columns.clone(),
    };
    if selected.is_empty() {
        return Ok(SqlitePageResult { columns: vec![], rows: vec![], next_cursor: None });
    }
    let select_list = selected.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");

    let mut pk_cols: Vec<&str> = description
        .columns
        .iter()
        .filter(|c| c.is_primary_key)
        .collect::<Vec<_>>()
        .into_iter()
        .map(|c| c.name.as_str())
        .collect();
    // Deterministic, stable ordering: the real composite PK when the
    // table has one, else SQLite's own implicit `rowid` — never
    // unordered (an unordered SELECT can return rows in a different
    // sequence between pages, silently corrupting pagination).
    let order_by = if pk_cols.is_empty() {
        "rowid".to_string()
    } else {
        pk_cols.drain(..).map(quote_ident).collect::<Vec<_>>().join(", ")
    };

    let mut where_clause = String::new();
    let mut bind_value: Option<String> = None;
    if let Some(f) = &filter {
        if !known_columns.contains(&f.column.as_str()) {
            return Err(format!("\"{}\" is not a real column on \"{table}\".", f.column));
        }
        let sql_op = match f.op.as_str() {
            "eq" => "=",
            "gt" => ">",
            "gte" => ">=",
            "lt" => "<",
            "lte" => "<=",
            other => return Err(format!("Unsupported filter operator \"{other}\".")),
        };
        where_clause = format!(" WHERE {} {} ?1", quote_ident(&f.column), sql_op);
        bind_value = Some(f.value.clone());
    }

    let offset: i64 = match &cursor {
        Some(c) => c.parse::<i64>().map_err(|_| "Invalid cursor.".to_string())?,
        None => 0,
    };

    let sql = format!(
        "SELECT {select_list} FROM {} {where_clause} ORDER BY {order_by} LIMIT ?{} OFFSET ?{}",
        quote_ident(&table),
        if bind_value.is_some() { 2 } else { 1 },
        if bind_value.is_some() { 3 } else { 2 },
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let col_count = selected.len();

    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<Vec<Option<String>>> {
        let mut out = Vec::with_capacity(col_count);
        for i in 0..col_count {
            let v: rusqlite::types::Value = row.get(i)?;
            out.push(match v {
                rusqlite::types::Value::Null => None,
                rusqlite::types::Value::Integer(n) => Some(n.to_string()),
                rusqlite::types::Value::Real(f) => Some(f.to_string()),
                rusqlite::types::Value::Text(s) => Some(s),
                rusqlite::types::Value::Blob(_) => Some("[binary data]".to_string()),
            });
        }
        Ok(out)
    };

    let query_rows = if let Some(v) = &bind_value {
        stmt.query_map(rusqlite::params![v, page_size, offset], map_row)
    } else {
        stmt.query_map(rusqlite::params![page_size, offset], map_row)
    }
    .map_err(|e| e.to_string())?;

    for r in query_rows {
        rows.push(r.map_err(|e| e.to_string())?);
    }

    let next_cursor = if rows.len() as i64 == page_size { Some((offset + page_size).to_string()) } else { None };

    Ok(SqlitePageResult {
        columns: selected.into_iter().map(|s| s.to_string()).collect(),
        rows,
        next_cursor,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection as RwConnection;

    fn fixture_db() -> String {
        let dir = std::env::temp_dir().join(format!("formulab-connector-sqlite-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("fixture-{}.sqlite", uuid_like()));
        let conn = RwConnection::open(&path).unwrap();
        conn.execute_batch(
            "
            CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE materials (
                code TEXT NOT NULL,
                supplier_id INTEGER,
                name TEXT NOT NULL,
                PRIMARY KEY (code),
                FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
            );
            INSERT INTO suppliers (id, name) VALUES (1, 'Acme Co');
            INSERT INTO materials (code, supplier_id, name) VALUES ('MAT-1', 1, 'First');
            INSERT INTO materials (code, supplier_id, name) VALUES ('MAT-2', 1, 'Second');
            INSERT INTO materials (code, supplier_id, name) VALUES ('MAT-3', NULL, 'Third');
            ",
        )
        .unwrap();
        path.to_string_lossy().to_string()
    }

    fn uuid_like() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos())
    }

    #[test]
    fn lists_at_least_two_real_tables() {
        let path = fixture_db();
        let tables = connector_sqlite_list_tables(path).unwrap();
        let names: Vec<&str> = tables.iter().map(|t| t.table.as_str()).collect();
        assert!(names.contains(&"suppliers"));
        assert!(names.contains(&"materials"));
        assert!(tables.iter().all(|t| t.kind == "table"));
    }

    #[test]
    fn describes_primary_key_and_nullability() {
        let path = fixture_db();
        let desc = connector_sqlite_describe_table(path, "materials".to_string()).unwrap();
        let code_col = desc.columns.iter().find(|c| c.name == "code").unwrap();
        assert!(code_col.is_primary_key);
        assert_eq!(code_col.primary_key_ordinal, Some(1));
        let supplier_col = desc.columns.iter().find(|c| c.name == "supplier_id").unwrap();
        assert!(supplier_col.nullable);
        let name_col = desc.columns.iter().find(|c| c.name == "name").unwrap();
        assert!(!name_col.nullable);
    }

    #[test]
    fn describes_foreign_keys() {
        let path = fixture_db();
        let desc = connector_sqlite_describe_table(path, "materials".to_string()).unwrap();
        assert_eq!(desc.foreign_keys.len(), 1);
        assert_eq!(desc.foreign_keys[0].to_table, "suppliers");
        assert_eq!(desc.foreign_keys[0].from_columns, vec!["supplier_id".to_string()]);
        assert_eq!(desc.foreign_keys[0].to_columns, vec!["id".to_string()]);
    }

    #[test]
    fn reads_bounded_pages_in_deterministic_pk_order() {
        let path = fixture_db();
        let page = connector_sqlite_read_page(path, "materials".to_string(), None, None, 2, None).unwrap();
        assert_eq!(page.rows.len(), 2);
        assert_eq!(page.next_cursor, Some("2".to_string()));
        let code_idx = page.columns.iter().position(|c| c == "code").unwrap();
        assert_eq!(page.rows[0][code_idx], Some("MAT-1".to_string()));
        assert_eq!(page.rows[1][code_idx], Some("MAT-2".to_string()));
    }

    #[test]
    fn last_page_reports_no_next_cursor() {
        let path = fixture_db();
        let page = connector_sqlite_read_page(path.clone(), "materials".to_string(), None, None, 2, Some("2".to_string())).unwrap();
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.next_cursor, None);
    }

    #[test]
    fn rejects_a_column_not_on_the_real_table() {
        let path = fixture_db();
        let err = connector_sqlite_read_page(path, "materials".to_string(), Some(vec!["not_a_real_column".to_string()]), None, 10, None).unwrap_err();
        assert!(err.contains("not a real column"));
    }

    #[test]
    fn rejects_a_table_that_does_not_exist() {
        let path = fixture_db();
        let err = connector_sqlite_describe_table(path, "not_a_real_table".to_string()).unwrap_err();
        assert!(err.contains("not a real table"));
    }

    #[test]
    fn no_write_statement_is_ever_reachable() {
        // Structural proof, not merely a runtime refusal: the read-only
        // open flag itself rejects any write attempted through this same
        // connection type.
        let path = fixture_db();
        let conn = open_readonly(&path).unwrap();
        let result = conn.execute("DELETE FROM materials", []);
        assert!(result.is_err(), "a read-only connection must refuse DELETE");
    }
}
