import type { Db } from '../db/connection.js';
import { all } from '../db/connection.js';

export interface IndexedIngredient { name: string; norm: string; value: number | null; unit: string | null; unitNote: string | null }
export interface IndexedProduct {
  product_id: string; brand_name: string; brand_norm: string; manufacturer: string | null; dose_form: string | null;
  strength_text: string | null; is_fdc: boolean; anomaly_flags: string[]; source: string; source_version: string;
  effective_from: string | null; batch_id: number; source_row_id: number; ingredients: IndexedIngredient[];
}

export class ProductIndex {
  byId = new Map<string, IndexedProduct>();
  byBrand = new Map<string, IndexedProduct[]>();
  ingredientVocab = new Set<string>();

  static build(db: Db): ProductIndex {
    const idx = new ProductIndex();
    const prods = all<Record<string, unknown>>(db, 'SELECT * FROM drug_products ORDER BY product_id');
    const ings = all<Record<string, unknown>>(db, 'SELECT * FROM product_ingredients ORDER BY product_id, position');
    const ingBy = new Map<string, IndexedIngredient[]>();
    for (const i of ings) {
      const l = ingBy.get(i.product_id as string) ?? [];
      l.push({ name: i.ingredient_name as string, norm: i.ingredient_norm as string, value: i.strength_value as number | null, unit: i.strength_unit as string | null, unitNote: i.strength_unit_note as string | null });
      ingBy.set(i.product_id as string, l);
      idx.ingredientVocab.add(i.ingredient_norm as string);
    }
    for (const p of prods) {
      const ip: IndexedProduct = {
        product_id: p.product_id as string, brand_name: p.brand_name as string, brand_norm: p.brand_norm as string,
        manufacturer: p.manufacturer as string | null, dose_form: p.dose_form as string | null, strength_text: p.strength_text as string | null,
        is_fdc: p.is_fdc === 1, anomaly_flags: JSON.parse((p.anomaly_flags as string) || '[]'), source: p.source as string,
        source_version: p.source_version as string, effective_from: p.effective_from as string | null, batch_id: p.batch_id as number,
        source_row_id: p.source_row_id as number, ingredients: ingBy.get(p.product_id as string) ?? [],
      };
      idx.byId.set(ip.product_id, ip);
      const l = idx.byBrand.get(ip.brand_norm) ?? [];
      l.push(ip);
      idx.byBrand.set(ip.brand_norm, l);
    }
    return idx;
  }
}
