import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Beaker, FlaskConical, ListChecks, Sparkles } from "lucide-react";
import {
  newId,
  type AnalyticalCompositionResult,
  type BenchmarkProduct,
  type IngredientDeclarationLine,
  type IngredientMapping,
  type IngredientMappingMethod,
  type RawMaterial,
  type ReverseConstraintSet,
  type ReverseFormulaCandidate,
  type ReverseFormulationStudy,
  type TargetProductProfile,
  INGREDIENT_MAPPING_METHODS,
  CANDIDATE_SCORE_TYPES,
} from "@ai4s/shared";
import { listRecords, upsertRecords, nowIso } from "@/lib/masterdata";
import { CandidateComparisonPanel, type ScoredCandidate } from "@/components/reverseFormulation/CandidateComparisonPanel";
import { cn } from "@/lib/cn";

type Section = "studies" | "products" | "target" | "candidates";
const SECTION_STUDIES: Section = "studies";
const SECTION_PRODUCTS: Section = "products";
const SECTION_TARGET: Section = "target";
const SECTION_CANDIDATES: Section = "candidates";

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

const DECLARATION_STATUS_KEY = {
  unmapped: "reverseFormulation.declarations.status.unmapped",
  mapped: "reverseFormulation.declarations.status.mapped",
  conflicted: "reverseFormulation.declarations.status.conflicted",
  rejected: "reverseFormulation.declarations.status.rejected",
} as const;

const MAPPING_STATUS_KEY = {
  proposed: "reverseFormulation.mappings.status.proposed",
  confirmed: "reverseFormulation.mappings.status.confirmed",
  rejected: "reverseFormulation.mappings.status.rejected",
} as const;

/** Shared compact input styling — matches the codebase's inline-form
 *  convention (e.g. `DataExchangePage`'s role select) rather than a
 *  nonexistent shorthand utility class. */
const INPUT = "rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-accent";

/**
 * The Reverse Formulation workspace: benchmark a competitor product, record
 * its evidence (declaration, analytical results), map ingredients to real
 * catalog materials, attach a target profile and constraints, then generate
 * and compare candidate formulas via the shared engine
 * (`packages/shared/src/engine/candidateGenerator.ts` /
 * `scoringModel.ts`). Every write goes through the typed master-data layer
 * (`@/lib/masterdata`) against the 11 Reverse Formulation collections — no
 * candidate here is ever promoted to a saved formulation; that integration
 * is Session 6.
 */
export function ReverseFormulationPage() {
  const { t } = useTranslation("session");

  const [studies, setStudies] = useState<ReverseFormulationStudy[]>([]);
  const [products, setProducts] = useState<BenchmarkProduct[]>([]);
  const [declarationLines, setDeclarationLines] = useState<IngredientDeclarationLine[]>([]);
  const [analyticalResults, setAnalyticalResults] = useState<AnalyticalCompositionResult[]>([]);
  const [mappings, setMappings] = useState<IngredientMapping[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [targetProfiles, setTargetProfiles] = useState<TargetProductProfile[]>([]);
  const [constraintSets, setConstraintSets] = useState<ReverseConstraintSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(SECTION_STUDIES);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, p, d, a, m, mat, tp, cs] = await Promise.all([
        listRecords("reverse_formulation_studies"),
        listRecords("benchmark_products"),
        listRecords("ingredient_declaration_lines"),
        listRecords("analytical_composition_results"),
        listRecords("ingredient_mappings"),
        listRecords("materials"),
        listRecords("target_product_profiles"),
        listRecords("reverse_constraint_sets"),
      ]);
      setStudies(s);
      setProducts(p);
      setDeclarationLines(d);
      setAnalyticalResults(a);
      setMappings(m);
      setMaterials(mat);
      setTargetProfiles(tp);
      setConstraintSets(cs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sortedStudies = useMemo(() => [...studies].sort((a, b) => a.code.localeCompare(b.code)), [studies]);
  const selectedStudy = studies.find((s) => s.id === selectedStudyId) ?? null;

  const attachedProducts = useMemo(
    () => products.filter((p) => selectedStudy?.benchmarkProductIds.includes(p.id)).sort((a, b) => a.code.localeCompare(b.code)),
    [products, selectedStudy],
  );
  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? attachedProducts[0] ?? null;
  const primaryProduct = attachedProducts[0] ?? null;

  const productLines = useMemo(
    () => declarationLines.filter((l) => l.benchmarkProductId === selectedProduct?.id).sort((a, b) => a.declaredOrder - b.declaredOrder),
    [declarationLines, selectedProduct],
  );
  const productAnalytical = useMemo(() => analyticalResults.filter((r) => r.benchmarkProductId === selectedProduct?.id), [analyticalResults, selectedProduct]);
  const productMappings = useMemo(() => {
    const lineIds = new Set(productLines.map((l) => l.id));
    return mappings.filter((m) => lineIds.has(m.declarationLineId));
  }, [mappings, productLines]);

  const primaryLines = useMemo(
    () => declarationLines.filter((l) => l.benchmarkProductId === primaryProduct?.id).sort((a, b) => a.declaredOrder - b.declaredOrder),
    [declarationLines, primaryProduct],
  );
  const primaryAnalytical = useMemo(() => analyticalResults.filter((r) => r.benchmarkProductId === primaryProduct?.id), [analyticalResults, primaryProduct]);
  const primaryMappings = useMemo(() => {
    const lineIds = new Set(primaryLines.map((l) => l.id));
    return mappings.filter((m) => lineIds.has(m.declarationLineId));
  }, [mappings, primaryLines]);

  const linkedTarget = targetProfiles.find((p) => p.id === selectedStudy?.targetProfileId) ?? null;
  const linkedConstraints = constraintSets.find((c) => c.id === selectedStudy?.constraintSetId) ?? null;

  const selectStudy = (id: string) => {
    setSelectedStudyId(id);
    setSelectedProductId(null);
    setSection(SECTION_PRODUCTS);
  };

  const saveCandidate = async ({ candidate, score }: ScoredCandidate) => {
    if (!selectedStudy || candidate.formula.length === 0) return;
    const candidateId = newId("rfcand");
    const candidateCode = `${selectedStudy.code}-${newId("c")}`;
    const record: ReverseFormulaCandidate = {
      id: candidateId,
      studyId: selectedStudy.id,
      candidateCode,
      name: candidateCode,
      revision: 0,
      generationMethod: "candidateGenerator",
      status: "generated",
      formulaLines: candidate.formula as ReverseFormulaCandidate["formulaLines"],
      predictedProperties: candidate.estimatedProperties,
      assumptions: candidate.notes,
      createdAt: nowIso(),
      createdBy: "local",
    };
    await upsertRecords("reverse_formula_candidates", [record]);
    const explanations = Object.entries(score.scores)
      .filter(([dim]) => (CANDIDATE_SCORE_TYPES as readonly string[]).includes(dim))
      .map(([dim, value]) => ({
        id: newId("scoreexpl"),
        candidateId,
        scoreType: dim as (typeof CANDIDATE_SCORE_TYPES)[number],
        score: value,
        weight: 1,
        reason: score.explanations[dim] ?? "",
      }));
    if (explanations.length > 0) await upsertRecords("candidate_score_explanations", explanations);
    await refresh();
  };

  if (loading && studies.length === 0) {
    return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("reverseFormulation.studies.loading")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <h1 className="text-[13px] font-medium text-text">{t("reverseFormulation.heading")}</h1>
        <nav className="flex flex-wrap gap-1" aria-label={t("reverseFormulation.heading")}>
          <SectionTab active={section === SECTION_STUDIES} onClick={() => setSection(SECTION_STUDIES)} icon={<ListChecks size={13} />}>
            {t("reverseFormulation.sections.studies")}
          </SectionTab>
          <SectionTab active={section === SECTION_PRODUCTS} onClick={() => selectedStudy && setSection(SECTION_PRODUCTS)} icon={<Beaker size={13} />} disabled={!selectedStudy}>
            {t("reverseFormulation.sections.products")}
          </SectionTab>
          <SectionTab active={section === SECTION_TARGET} onClick={() => selectedStudy && setSection(SECTION_TARGET)} icon={<FlaskConical size={13} />} disabled={!selectedStudy}>
            {t("reverseFormulation.sections.target")}
          </SectionTab>
          <SectionTab active={section === SECTION_CANDIDATES} onClick={() => selectedStudy && setSection(SECTION_CANDIDATES)} icon={<Sparkles size={13} />} disabled={!selectedStudy}>
            {t("reverseFormulation.sections.candidates")}
          </SectionTab>
        </nav>
        {selectedStudy && (
          <span className="ml-auto truncate text-[11px] text-muted">
            {selectedStudy.code} · {selectedStudy.name}
          </span>
        )}
      </header>

      {error && (
        <div role="alert" className="shrink-0 bg-error/10 px-4 py-2 text-[12px] text-error">
          {t("reverseFormulation.errors.load", { message: error })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {section === "studies" && <StudiesSection studies={sortedStudies} selectedId={selectedStudyId} onSelect={selectStudy} onCreated={refresh} />}

        {section === "products" && selectedStudy && (
          <ProductsSection
            study={selectedStudy}
            attachedProducts={attachedProducts}
            allProducts={products}
            selectedProduct={selectedProduct}
            onSelectProduct={setSelectedProductId}
            onChanged={refresh}
            lines={productLines}
            analytical={productAnalytical}
            mappings={productMappings}
            materials={materials}
          />
        )}

        {section === "target" && selectedStudy && (
          <TargetSection study={selectedStudy} linkedTarget={linkedTarget} linkedConstraints={linkedConstraints} targetProfiles={targetProfiles} constraintSets={constraintSets} onChanged={refresh} />
        )}

        {section === "candidates" && selectedStudy && (
          <CandidateComparisonPanel
            study={selectedStudy}
            primaryProduct={primaryProduct}
            declarationLines={primaryLines}
            mappings={primaryMappings}
            analyticalResults={primaryAnalytical}
            materials={materials}
            target={linkedTarget}
            constraints={linkedConstraints}
            onSaveCandidate={saveCandidate}
          />
        )}
      </div>
    </div>
  );
}

function SectionTab({ active, onClick, icon, children, disabled }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={cn("flex items-center gap-1.5 rounded-input px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40", active ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text")}
    >
      {icon}
      {children}
    </button>
  );
}

// ------------------------------------------------------------- studies ---

function StudiesSection({
  studies,
  selectedId,
  onSelect,
  onCreated,
}: {
  studies: ReverseFormulationStudy[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: () => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [familyCode, setFamilyCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async () => {
    if (!code.trim() || !name.trim() || !projectCode.trim() || !familyCode.trim()) {
      setFormError(t("reverseFormulation.studies.required"));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const record: ReverseFormulationStudy = {
        id: newId("rfstudy"),
        code: code.trim(),
        name: name.trim(),
        projectId: projectCode.trim(),
        productFamilyCode: familyCode.trim(),
        status: "draft",
        benchmarkProductIds: [],
        createdAt: nowIso(),
        createdBy: "local",
        updatedAt: nowIso(),
        revision: 0,
      };
      await upsertRecords("reverse_formulation_studies", [record]);
      await onCreated();
      onSelect(record.id);
      setCreating(false);
      setCode("");
      setName("");
      setProjectCode("");
      setFamilyCode("");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-text">{t("reverseFormulation.sections.studies")}</h2>
        <button onClick={() => setCreating((v) => !v)} className="rounded-input bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90">
          {t("reverseFormulation.studies.newDraft")}
        </button>
      </div>

      {creating && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3">
          <Field label={t("reverseFormulation.studies.codeLabel")}>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("reverseFormulation.studies.nameLabel")}>
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("reverseFormulation.studies.projectLabel")}>
            <input value={projectCode} onChange={(e) => setProjectCode(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("reverseFormulation.studies.familyLabel")}>
            <input value={familyCode} onChange={(e) => setFamilyCode(e.target.value)} className={INPUT} />
          </Field>
          <button onClick={() => void create()} disabled={busy} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
            {t("reverseFormulation.studies.create")}
          </button>
          {formError && (
            <span role="alert" className="text-[11px] text-error">
              {formError}
            </span>
          )}
        </div>
      )}

      {studies.length === 0 ? (
        <Empty text={t("reverseFormulation.studies.empty")} />
      ) : (
        <ul className="divide-y divide-border-faint rounded-card border border-border">
          {studies.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-text">
                  {s.code} · {s.name}
                </div>
                <div className="truncate text-[11px] text-muted">
                  {t("reverseFormulation.studies.statusLabel")}: {s.status} · {s.productFamilyCode}
                </div>
              </div>
              <button
                onClick={() => onSelect(s.id)}
                className={cn("shrink-0 rounded-input border px-2 py-1 text-[11px]", selectedId === s.id ? "border-accent text-accent" : "border-border text-muted hover:bg-surface-2 hover:text-text")}
              >
                {selectedId === s.id ? t("reverseFormulation.studies.selected") : t("reverseFormulation.studies.select")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------ products ---

function ProductsSection({
  study,
  attachedProducts,
  allProducts,
  selectedProduct,
  onSelectProduct,
  onChanged,
  lines,
  analytical,
  mappings,
  materials,
}: {
  study: ReverseFormulationStudy;
  attachedProducts: BenchmarkProduct[];
  allProducts: BenchmarkProduct[];
  selectedProduct: BenchmarkProduct | null;
  onSelectProduct: (id: string) => void;
  onChanged: () => Promise<void>;
  lines: IngredientDeclarationLine[];
  analytical: AnalyticalCompositionResult[];
  mappings: IngredientMapping[];
  materials: RawMaterial[];
}) {
  const { t } = useTranslation("session");
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const unattached = allProducts.filter((p) => !study.benchmarkProductIds.includes(p.id));

  const attach = async (productId: string) => {
    const updated: ReverseFormulationStudy = { ...study, benchmarkProductIds: [...study.benchmarkProductIds, productId], updatedAt: nowIso() };
    await upsertRecords("reverse_formulation_studies", [updated]);
    await onChanged();
  };

  const createAndAttach = async () => {
    if (!code.trim() || !name.trim()) return;
    setBusy(true);
    try {
      const record: BenchmarkProduct = {
        id: newId("bmprod"),
        code: code.trim(),
        name: name.trim(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await upsertRecords("benchmark_products", [record]);
      await attach(record.id);
      setCreating(false);
      setCode("");
      setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-text">{t("reverseFormulation.sections.products")}</h2>
        <div className="flex items-center gap-2">
          {unattached.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) void attach(e.target.value);
                e.target.value = "";
              }}
              defaultValue=""
              className={INPUT}
              aria-label={t("reverseFormulation.products.attach")}
            >
              <option value="" disabled>
                {t("reverseFormulation.products.attach")}
              </option>
              {unattached.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          )}
          <button onClick={() => setCreating((v) => !v)} className="rounded-input bg-accent px-2.5 py-1 text-[11px] font-medium text-accent-fg hover:opacity-90">
            {t("reverseFormulation.products.newProduct")}
          </button>
        </div>
      </div>

      {creating && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3">
          <Field label={t("reverseFormulation.products.codeLabel")}>
            <input value={code} onChange={(e) => setCode(e.target.value)} className={INPUT} />
          </Field>
          <Field label={t("reverseFormulation.products.nameLabel")}>
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </Field>
          <button onClick={() => void createAndAttach()} disabled={busy} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
            {t("reverseFormulation.products.add")}
          </button>
        </div>
      )}

      {attachedProducts.length === 0 ? (
        <Empty text={t("reverseFormulation.products.empty")} />
      ) : (
        <ul className="divide-y divide-border-faint rounded-card border border-border">
          {attachedProducts.map((p) => (
            <li key={p.id} className="px-3 py-2">
              <button onClick={() => onSelectProduct(p.id)} className="w-full text-left">
                <div className={cn("text-[12px] font-medium", selectedProduct?.id === p.id ? "text-accent" : "text-text")}>
                  {p.code} · {p.name}
                </div>
                {p.brand && <div className="text-[11px] text-muted">{p.brand}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedProduct && (
        <div className="space-y-3 rounded-card border border-border-faint bg-surface-2/40 p-3">
          <DeclarationsPanel product={selectedProduct} lines={lines} onChanged={onChanged} />
          <AnalyticalPanel product={selectedProduct} results={analytical} onChanged={onChanged} />
          <MappingsPanel studyId={study.id} lines={lines} mappings={mappings} materials={materials} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function DeclarationsPanel({ product, lines, onChanged }: { product: BenchmarkProduct; lines: IngredientDeclarationLine[]; onChanged: () => Promise<void> }) {
  const { t } = useTranslation("session");
  const [order, setOrder] = useState("");
  const [name, setName] = useState("");
  const [hint, setHint] = useState("");

  const add = async () => {
    const parsedOrder = Number.parseInt(order, 10);
    if (!name.trim() || Number.isNaN(parsedOrder)) return;
    const record: IngredientDeclarationLine = {
      id: newId("declline"),
      benchmarkProductId: product.id,
      rawText: name.trim(),
      normalizedText: name.trim().toLowerCase(),
      declaredOrder: parsedOrder,
      declaredName: name.trim(),
      // A blank hint stays blank — never coerced to "0%".
      concentrationHint: hint.trim() ? hint.trim() : undefined,
      mappingStatus: "unmapped",
      mappedMaterialIds: [],
    };
    await upsertRecords("ingredient_declaration_lines", [record]);
    setOrder("");
    setName("");
    setHint("");
    await onChanged();
  };

  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-semibold text-text">{t("reverseFormulation.declarations.heading")}</h3>
      {lines.length === 0 ? (
        <Empty text={t("reverseFormulation.declarations.empty")} />
      ) : (
        <ul className="mb-2 divide-y divide-border-faint rounded-input border border-border-faint bg-surface text-[11px]">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-2 py-1">
              <span className="w-6 shrink-0 text-right font-mono tabular-nums text-muted">{l.declaredOrder}</span>
              <span className="flex-1 truncate text-text">{l.declaredName}</span>
              <span className="shrink-0 text-muted">{l.concentrationHint ?? t("reverseFormulation.declarations.unknown")}</span>
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", l.mappingStatus === "mapped" ? "bg-ok/15 text-ok" : "bg-surface-2 text-muted")}>
                {t(DECLARATION_STATUS_KEY[l.mappingStatus])}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-1.5">
        <Field label={t("reverseFormulation.declarations.orderLabel")}>
          <input value={order} onChange={(e) => setOrder(e.target.value)} className={cn(INPUT, "w-16")} inputMode="numeric" />
        </Field>
        <Field label={t("reverseFormulation.declarations.nameLabel")}>
          <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("reverseFormulation.declarations.hintLabel")}>
          <input value={hint} onChange={(e) => setHint(e.target.value)} className={INPUT} />
        </Field>
        <button onClick={() => void add()} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
          {t("reverseFormulation.declarations.add")}
        </button>
      </div>
    </section>
  );
}

function AnalyticalPanel({ product, results, onChanged }: { product: BenchmarkProduct; results: AnalyticalCompositionResult[]; onChanged: () => Promise<void> }) {
  const { t } = useTranslation("session");
  const [analysisType, setAnalysisType] = useState("");
  const [analyte, setAnalyte] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const add = async () => {
    if (!analysisType.trim() || !analyte.trim() || !unit.trim()) return;
    if (!DECIMAL_STRING.test(value.trim())) {
      setFormError(t("reverseFormulation.analytical.invalidValue"));
      return;
    }
    setFormError(null);
    const record: AnalyticalCompositionResult = {
      id: newId("analresult"),
      benchmarkProductId: product.id,
      analysisType: analysisType.trim(),
      analyte: analyte.trim(),
      value: value.trim(),
      unit: unit.trim(),
      // An import/entry never verifies its own measurement.
      verificationStatus: "unverified",
    };
    await upsertRecords("analytical_composition_results", [record]);
    setAnalysisType("");
    setAnalyte("");
    setValue("");
    setUnit("");
    await onChanged();
  };

  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-semibold text-text">{t("reverseFormulation.analytical.heading")}</h3>
      {results.length === 0 ? (
        <Empty text={t("reverseFormulation.analytical.empty")} />
      ) : (
        <ul className="mb-2 divide-y divide-border-faint rounded-input border border-border-faint bg-surface text-[11px]">
          {results.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-2 py-1">
              <span className="flex-1 truncate text-text">
                {r.analysisType} · {r.analyte}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-text">
                {r.value} {r.unit}
              </span>
              <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{t("reverseFormulation.analytical.unverified")}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-1.5">
        <Field label={t("reverseFormulation.analytical.typeLabel")}>
          <input value={analysisType} onChange={(e) => setAnalysisType(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("reverseFormulation.analytical.analyteLabel")}>
          <input value={analyte} onChange={(e) => setAnalyte(e.target.value)} className={INPUT} />
        </Field>
        <Field label={t("reverseFormulation.analytical.valueLabel")}>
          <input value={value} onChange={(e) => setValue(e.target.value)} className={cn(INPUT, "w-20")} />
        </Field>
        <Field label={t("reverseFormulation.analytical.unitLabel")}>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} className={cn(INPUT, "w-16")} />
        </Field>
        <button onClick={() => void add()} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
          {t("reverseFormulation.analytical.add")}
        </button>
        {formError && (
          <span role="alert" className="text-[11px] text-error">
            {formError}
          </span>
        )}
      </div>
    </section>
  );
}

function MappingsPanel({
  studyId,
  lines,
  mappings,
  materials,
  onChanged,
}: {
  studyId: string;
  lines: IngredientDeclarationLine[];
  mappings: IngredientMapping[];
  materials: RawMaterial[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const [lineId, setLineId] = useState("");
  const [materialCode, setMaterialCode] = useState("");
  const [method, setMethod] = useState<IngredientMappingMethod>("manual");
  const [confidence, setConfidence] = useState("");

  const setStatus = async (mapping: IngredientMapping, status: "confirmed" | "rejected") => {
    await upsertRecords("ingredient_mappings", [{ ...mapping, status, updatedAt: nowIso() }]);
    await onChanged();
  };

  const add = async () => {
    const line = lines.find((l) => l.id === lineId);
    const material = materials.find((m) => m.code === materialCode);
    const parsedConfidence = Number.parseFloat(confidence);
    if (!line || !material || Number.isNaN(parsedConfidence)) return;
    const record: IngredientMapping = {
      id: newId("imapping"),
      studyId,
      benchmarkProductId: line.benchmarkProductId,
      declarationLineId: line.id,
      candidateMaterialId: material.code,
      mappingMethod: method,
      confidence: Math.min(1, Math.max(0, parsedConfidence)),
      status: "proposed",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await upsertRecords("ingredient_mappings", [record]);
    setLineId("");
    setMaterialCode("");
    setConfidence("");
    await onChanged();
  };

  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-semibold text-text">{t("reverseFormulation.mappings.heading")}</h3>
      {mappings.length === 0 ? (
        <Empty text={t("reverseFormulation.mappings.empty")} />
      ) : (
        <ul className="mb-2 divide-y divide-border-faint rounded-input border border-border-faint bg-surface text-[11px]">
          {mappings.map((m) => {
            const line = lines.find((l) => l.id === m.declarationLineId);
            const material = materials.find((mat) => mat.code === m.candidateMaterialId);
            return (
              <li key={m.id} className="flex items-center gap-2 px-2 py-1">
                <span className="flex-1 truncate text-text">
                  {line?.declaredName ?? m.declarationLineId} → {material?.displayName ?? m.candidateMaterialId}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted">{m.confidence.toFixed(2)}</span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px]",
                    m.status === "confirmed" ? "bg-ok/15 text-ok" : m.status === "rejected" ? "bg-error/15 text-error" : "bg-surface-2 text-muted",
                  )}
                >
                  {t(MAPPING_STATUS_KEY[m.status])}
                </span>
                {m.status === "proposed" && (
                  <span className="flex shrink-0 gap-1">
                    <button onClick={() => void setStatus(m, "confirmed")} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2 hover:text-text">
                      {t("reverseFormulation.mappings.confirm")}
                    </button>
                    <button onClick={() => void setStatus(m, "rejected")} className="rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2 hover:text-text">
                      {t("reverseFormulation.mappings.reject")}
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lines.length > 0 && (
        <div className="flex flex-wrap items-end gap-1.5">
          <Field label={t("reverseFormulation.declarations.nameLabel")}>
            <select value={lineId} onChange={(e) => setLineId(e.target.value)} className={INPUT}>
              <option value="" />
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.declaredName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("reverseFormulation.mappings.materialLabel")}>
            <select value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} className={INPUT}>
              <option value="" />
              {materials.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("reverseFormulation.mappings.methodLabel")}>
            <select value={method} onChange={(e) => setMethod(e.target.value as IngredientMappingMethod)} className={INPUT}>
              {INGREDIENT_MAPPING_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("reverseFormulation.mappings.confidenceLabel")}>
            <input value={confidence} onChange={(e) => setConfidence(e.target.value)} className={cn(INPUT, "w-16")} />
          </Field>
          <button onClick={() => void add()} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
            {t("reverseFormulation.mappings.add")}
          </button>
        </div>
      )}
    </section>
  );
}

// -------------------------------------------------- target & constraints ---

function TargetSection({
  study,
  linkedTarget,
  linkedConstraints,
  targetProfiles,
  constraintSets,
  onChanged,
}: {
  study: ReverseFormulationStudy;
  linkedTarget: TargetProductProfile | null;
  linkedConstraints: ReverseConstraintSet | null;
  targetProfiles: TargetProductProfile[];
  constraintSets: ReverseConstraintSet[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const [profileCode, setProfileCode] = useState("");
  const [profileName, setProfileName] = useState("");
  const [phMin, setPhMin] = useState("");
  const [phMax, setPhMax] = useState("");
  const [constraintCode, setConstraintCode] = useState("");
  const [constraintName, setConstraintName] = useState("");
  const [excluded, setExcluded] = useState("");

  const createProfile = async () => {
    if (!profileCode.trim() || !profileName.trim()) return;
    const record: TargetProductProfile = {
      id: newId("tpp"),
      code: profileCode.trim(),
      name: profileName.trim(),
      productFamilyCode: study.productFamilyCode,
      pHMin: phMin.trim() ? Number(phMin) : undefined,
      pHMax: phMax.trim() ? Number(phMax) : undefined,
      jurisdictions: [],
    };
    await upsertRecords("target_product_profiles", [record]);
    await upsertRecords("reverse_formulation_studies", [{ ...study, targetProfileId: record.id, updatedAt: nowIso() }]);
    setProfileCode("");
    setProfileName("");
    setPhMin("");
    setPhMax("");
    await onChanged();
  };

  const createConstraints = async () => {
    if (!constraintCode.trim() || !constraintName.trim()) return;
    const record: ReverseConstraintSet = {
      id: newId("rconstraint"),
      code: constraintCode.trim(),
      name: constraintName.trim(),
      studyId: study.id,
      requiredMaterials: [],
      preferredMaterials: [],
      excludedMaterials: excluded
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      requiredFunctions: [],
      minimumPercentages: {},
      maximumPercentages: {},
    };
    await upsertRecords("reverse_constraint_sets", [record]);
    await upsertRecords("reverse_formulation_studies", [{ ...study, constraintSetId: record.id, updatedAt: nowIso() }]);
    setConstraintCode("");
    setConstraintName("");
    setExcluded("");
    await onChanged();
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="rounded-card border border-border bg-surface p-3">
        <h2 className="mb-2 text-[13px] font-semibold text-text">{t("reverseFormulation.target.profileHeading")}</h2>
        {linkedTarget ? (
          <div className="text-[12px] text-text">
            <div className="font-medium">
              {linkedTarget.code} · {linkedTarget.name}
            </div>
            <div className="text-[11px] text-muted">
              {t("reverseFormulation.target.phRangeLabel")}: {linkedTarget.pHMin ?? t("reverseFormulation.declarations.unknown")}–{linkedTarget.pHMax ?? t("reverseFormulation.declarations.unknown")}
            </div>
          </div>
        ) : (
          <>
            <Empty text={t("reverseFormulation.target.empty")} />
            {targetProfiles.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) void upsertRecords("reverse_formulation_studies", [{ ...study, targetProfileId: e.target.value, updatedAt: nowIso() }]).then(onChanged);
                  e.target.value = "";
                }}
                defaultValue=""
                className={cn(INPUT, "mb-2 w-full")}
                aria-label={t("reverseFormulation.target.linkExisting")}
              >
                <option value="" disabled>
                  {t("reverseFormulation.target.linkExisting")}
                </option>
                {targetProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex flex-wrap items-end gap-1.5">
              <Field label={t("reverseFormulation.studies.codeLabel")}>
                <input value={profileCode} onChange={(e) => setProfileCode(e.target.value)} className={INPUT} />
              </Field>
              <Field label={t("reverseFormulation.studies.nameLabel")}>
                <input value={profileName} onChange={(e) => setProfileName(e.target.value)} className={INPUT} />
              </Field>
              <Field label={t("reverseFormulation.target.phMinLabel")}>
                <input value={phMin} onChange={(e) => setPhMin(e.target.value)} className={cn(INPUT, "w-16")} />
              </Field>
              <Field label={t("reverseFormulation.target.phMaxLabel")}>
                <input value={phMax} onChange={(e) => setPhMax(e.target.value)} className={cn(INPUT, "w-16")} />
              </Field>
              <button onClick={() => void createProfile()} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90">
                {t("reverseFormulation.target.createProfile")}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="rounded-card border border-border bg-surface p-3">
        <h2 className="mb-2 text-[13px] font-semibold text-text">{t("reverseFormulation.target.constraintsHeading")}</h2>
        {linkedConstraints ? (
          <div className="text-[12px] text-text">
            <div className="font-medium">
              {linkedConstraints.code} · {linkedConstraints.name}
            </div>
            <div className="text-[11px] text-muted">
              {t("reverseFormulation.target.excludedMaterials")}: {linkedConstraints.excludedMaterials.length > 0 ? linkedConstraints.excludedMaterials.join(", ") : t("reverseFormulation.declarations.unknown")}
            </div>
          </div>
        ) : (
          <>
            <Empty text={t("reverseFormulation.target.constraintsEmpty")} />
            {constraintSets.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) void upsertRecords("reverse_formulation_studies", [{ ...study, constraintSetId: e.target.value, updatedAt: nowIso() }]).then(onChanged);
                  e.target.value = "";
                }}
                defaultValue=""
                className={cn(INPUT, "mb-2 w-full")}
                aria-label={t("reverseFormulation.target.linkExisting")}
              >
                <option value="" disabled>
                  {t("reverseFormulation.target.linkExisting")}
                </option>
                {constraintSets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex flex-wrap items-end gap-1.5">
              <Field label={t("reverseFormulation.studies.codeLabel")}>
                <input value={constraintCode} onChange={(e) => setConstraintCode(e.target.value)} className={INPUT} />
              </Field>
              <Field label={t("reverseFormulation.studies.nameLabel")}>
                <input value={constraintName} onChange={(e) => setConstraintName(e.target.value)} className={INPUT} />
              </Field>
              <Field label={t("reverseFormulation.target.excludedMaterials")}>
                <input value={excluded} onChange={(e) => setExcluded(e.target.value)} className={INPUT} />
              </Field>
              <button onClick={() => void createConstraints()} className="rounded-input bg-accent px-2.5 py-1.5 text-[11px] font-medium text-accent-fg hover:opacity-90">
                {t("reverseFormulation.target.createConstraints")}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// --------------------------------------------------------------- shared ---

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 py-4 text-center text-[12px] text-muted">{text}</p>;
}
