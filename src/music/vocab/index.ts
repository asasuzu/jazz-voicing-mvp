import type { DensityPreset } from '../types'

/**
 * 語彙レジストリ。第1段階では画面のON/OFFチェックボックスは無いが
 * (それはUIの話でIMPLEMENTATION_PLAN.md Step5の範囲外)、
 * どのdensityがどの語彙を使うかをここに集約しておく(docs/DESIGN_v0.2.md §5.4)。
 * Quartal / UST / Drop2 / Cluster 等は第2段階で追加する(IMPLEMENTATION_PLAN.md §11)。
 */
export interface VocabModule {
  id: string
  label: string
  description: string
  tier: 'core' | 'color' | 'modern'
  densities: DensityPreset[]
}

export const VOCAB_MODULES: VocabModule[] = [
  {
    id: 'rootless',
    label: 'Rootless',
    description: '3度・7度を左手の核にして、9th/13th等の色を右手に足す標準語彙。',
    tier: 'core',
    densities: ['standard', 'thick'],
  },
  {
    id: 'powell',
    label: 'Bud Powell shell',
    description: 'ルート+1音(7th/3rd/6th/10th)の2〜3音シェル。右手を空けてソロや上物に譲る。',
    tier: 'core',
    densities: ['powell', 'shell3'],
  },
]

export function vocabForDensity(density: DensityPreset): VocabModule | undefined {
  return VOCAB_MODULES.find((module) => module.densities.includes(density))
}
