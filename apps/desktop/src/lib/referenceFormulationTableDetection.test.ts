import { describe, expect, it } from "vitest";
import { detectIngredientTables, type PositionedLine } from "./referenceFormulationTableDetection";

// Geometry mirrors real supplier PDFs read through PDF.js (x/y in PDF points).
function line(y: number, cells: Array<[number, string]>): PositionedLine {
  return { text: cells.map(([, text]) => text).join(" "), position: { x: cells[0]![0], y }, fragments: cells.map(([x, text]) => ({ text, x })) };
}

describe("detectIngredientTables", () => {
  it("reads a Product / Functionality / % W/W table and stops at the method heading", () => {
    const [table] = detectIngredientTables([
      line(692, [[71, "Alkaline Cleaner"], [448, "HC/HS/34"]]),
      line(648, [[71, "Product"], [332, "Functionality"], [488, "% W/W"]]),
      line(635, [[71, "Hydrotrope X"], [332, "Hydrotrope"], [509, "1.0"]]),
      line(622, [[71, "Sodium hydroxide 47%"], [332, "pH adjuster, base"], [503, "90.0"]]),
      line(597, [[71, "Water"], [332, "Solvent"], [509, "9.0"]]),
      line(567, [[71, "Method"]]),
      line(553, [[71, "Add sodium hydroxide to water 1.0"]]),
    ]);
    expect(table!.rows).toEqual([
      ["Ingredient", "Function", "% w/w"],
      ["Hydrotrope X", "Hydrotrope", "1.0"],
      ["Sodium hydroxide 47%", "pH adjuster, base", "90.0"],
      ["Water", "Solvent", "9.0"],
    ]);
  });

  it("keeps phase, INCI and supplier columns and joins a wrapped INCI cell to its row", () => {
    const [table] = detectIngredientTables([
      line(585, [[59, "Phase"], [107, "Ingredient"], [232, "INCI"], [385, "% w/w"], [436, "Manufacturer"]]),
      line(568, [[59, "A"], [107, "Emulsifier A"], [232, "PEG-40 Hydrogenated Castor Oil"], [385, "6.00"], [436, "Evonik"]]),
      line(550, [[59, "A"], [107, "Blend B"], [232, "Ceramide NG; Olea Europaea (Olive) Fruit"], [385, "1.00"], [436, "Evonik"]]),
      line(540, [[232, "Oil; Ricinus communis (Castor) Seed Oil"]]),
      line(522, [[59, "B"], [107, "Glycerin"], [385, "2.00"], [436, "various"]]),
      line(504, [[59, "C"], [107, "Lactic Acid, 10% in water"], [232, "2-Hydroxypropionic acid"], [385, "q.s."], [436, "various"]]),
      line(485, [[54, "Specifications"]]),
    ]);
    expect(table!.rows[0]).toEqual(["Phase", "Ingredient", "INCI", "Supplier", "% w/w"]);
    expect(table!.rows[2]).toEqual(["A", "Blend B", "Ceramide NG; Olea Europaea (Olive) Fruit Oil; Ricinus communis (Castor) Seed Oil", "Evonik", "1.00"]);
    expect(table!.rows[3]).toEqual(["B", "Glycerin", "", "various", "2.00"]);
    expect(table!.rows.at(-1)).toEqual(["C", "Lactic Acid, 10% in water", "2-Hydroxypropionic acid", "various", "q.s."]);
  });

  it("reads INCI-only rows when the trade-name cell is empty", () => {
    const [table] = detectIngredientTables([
      line(453, [[38, "Phase"], [76, "Seppic product / ingredient"], [206, "Chemical name"], [316, "INCI"], [486, "Amount"], [541, "Supplier"]]),
      line(437, [[38, "A"], [316, "Water(Aqua)"], [486, "44.65 %"]]),
      line(404, [[38, "A"], [76, "GUM AX"], [316, "Acacia Senegal Gum, Xanthan Gum"], [486, "0.3 %"], [541, "Seppic"]]),
      line(387, [[38, "A"], [316, "Glycerin"], [486, "3 %"]]),
    ]);
    expect(table!.rows.slice(1)).toEqual([
      ["A", "", "Water(Aqua)", "", "44.65 %"],
      ["A", "GUM AX", "Acacia Senegal Gum, Xanthan Gum", "Seppic", "0.3 %"],
      ["A", "", "Glycerin", "", "3 %"],
    ]);
  });

  it("turns roman-numeral markers left of the table into a phase column and joins wrapped functions", () => {
    const [table] = detectIngredientTables([
      line(554, [[77, "Ingredients"], [216, "Chemical Description"], [384, "%"], [468, "Function"]]),
      line(525, [[38, "I."], [74, "Trisodium Citrate"], [381, "39,5"], [429, "Cleaning agent"]]),
      line(504, [[74, "Sodium Di Silicate"], [381, "35,0"], [429, "Cleaning agent"]]),
      line(483, [[38, "II."], [74, "SURFACTANT"], [133, "LS 54"], [210, "Fatty Alcohol Alkoxylate"], [383, "2,0"], [429, "Surfactant / low"]]),
      line(469, [[429, "foaming agent"]]),
      line(440, [[38, "Procedures"]]),
    ]);
    expect(table!.rows).toEqual([
      ["Phase", "Ingredient", "INCI", "Function", "% w/w"],
      ["I.", "Trisodium Citrate", "", "Cleaning agent", "39,5"],
      ["", "Sodium Di Silicate", "", "Cleaning agent", "35,0"],
      ["II.", "SURFACTANT LS 54", "Fatty Alcohol Alkoxylate", "Surfactant / low foaming agent", "2,0"],
    ]);
  });

  it("joins trade names split into two fragments and keeps q.s. / up-to amounts as printed", () => {
    const [table] = detectIngredientTables([
      line(404, [[85, "COMPOSITION"], [401, "%"]]),
      line(381, [[142, "QUAT"], [210, "60W25"], [401, "8.0"]]),
      line(369, [[142, "BETAINE"], [196, "HR"], [401, "2.0"]]),
      line(333, [[142, "Preservative"], [401, "q.s"]]),
      line(299, [[142, "Deionized Water"], [401, "Up to 100%"]]),
      line(238, [[85, "TECHNICAL CHARACTERISTICS"]]),
    ]);
    expect(table!.rows.slice(1)).toEqual([["QUAT 60W25", "8.0"], ["BETAINE HR", "2.0"], ["Preservative", "q.s"], ["Deionized Water", "Up to 100%"]]);
  });

  it("splits side-by-side formulas into one table per amount column, skipping ingredients a variant does not use", () => {
    const tables = detectIngredientTables([
      line(609, [[96, "Component"], [208, "#1 Percentage (%)"], [335, "#2 Percentage (%)"], [462, "#3 Percentage (%)"]]),
      line(586, [[65, "Glycol ether PnB"], [235, "3.5-4.0"], [362, "3.0-3.5"]]),
      line(563, [[65, "Glycol ether PM"], [362, "1.5-2.0"]]),
      line(540, [[65, "Glycol ether PnP"], [489, "3.2-5.0"]]),
      line(517, [[65, "Monoethanolamine"], [235, "0.2-0.4"], [362, "0.2-0.4"], [489, "0.2-0.4"]]),
      line(494, [[65, "Water"], [230, "up to 100"], [357, "up to 100"], [484, "up to 100"]]),
      line(470, [[65, "Note:"]]),
    ]);
    expect(tables.map((table) => [table.variant, table.variantCount, table.rows.length - 1])).toEqual([[1, 3, 3], [2, 3, 4], [3, 3, 3]]);
    expect(tables[2]!.rows.slice(1).map((row) => row[0])).toEqual(["Glycol ether PnP", "Monoethanolamine", "Water"]);
  });

  it("accepts weight-percent header spellings", () => {
    for (const header of ["Weight (%)", "wt%", "% by weight", "% (w/w)"]) {
      const [table] = detectIngredientTables([
        line(600, [[60, "Component"], [300, header]]),
        line(585, [[60, "Glycol ether"], [300, "10"]]),
        line(570, [[60, "Water"], [300, "90"]]),
      ]);
      expect(table?.amountHeader).toBe(header);
    }
  });

  it("treats a dash as 'not in this formula' rather than an amount", () => {
    const tables = detectIngredientTables([
      line(600, [[60, "Ingredient"], [300, "% w/w"], [360, "% w/w"]]),
      line(585, [[60, "Repellent A"], [300, "20"], [360, "-"]]),
      line(570, [[60, "Repellent B"], [300, "-"], [360, "20"]]),
      line(555, [[60, "Oil"], [300, "80"], [360, "80"]]),
    ]);
    expect(tables.map((table) => table.rows.slice(1).map((row) => row[0]))).toEqual([["Repellent A", "Oil"], ["Repellent B", "Oil"]]);
  });

  it("finds nothing on pages without a recognised ingredient header", () => {
    expect(detectIngredientTables([
      line(700, [[50, "Typical properties"]]),
      line(680, [[50, "Viscosity"], [300, "500 cP"]]),
    ])).toEqual([]);
  });
});
