import { describe, expect, it } from 'vitest'
import { isPlayable, checkPlayability } from '../src/music/playability'
import type { Voicing } from '../src/music/types'

/**
 * ここでの合否は「弾けるか / 確実に濁るか」だけを見る。響きの好みは判定しない。
 * 仕様: docs/IMPLEMENTATION_PLAN.md §2, §10
 */

function voicing(left: number[], right: number[] = []): Voicing {
  return {
    family: 'test',
    label: 'test',
    left,
    right,
    degrees: [...left, ...right].map(() => '1'),
  }
}

describe('片手の幅', () => {
  it('10度(16半音)は許可される。利用者が届くため', () => {
    // F2(41) + A3(57) = 16半音。Powell の R10
    expect(isPlayable(voicing([41, 57]))).toBe(true)
  })

  it('17半音は届かないので落とす', () => {
    expect(isPlayable(voicing([41, 58]))).toBe(false)
  })

  it('片手5音は落とす', () => {
    expect(isPlayable(voicing([52, 55, 58, 60, 62]))).toBe(false)
  })
})

describe('両手の関係', () => {
  it('手が交差していたら落とす', () => {
    // 左手の最高音(67)が右手の最低音(64)より上
    expect(isPlayable(voicing([60, 67], [64, 70]))).toBe(false)
  })

  it('左右が離れすぎていたら落とす', () => {
    // 左手最高音 55 と右手最低音 72 で17半音空いている
    expect(isPlayable(voicing([48, 55], [72, 76]))).toBe(false)
  })

  it('普通の両手ボイシングは通る', () => {
    expect(isPlayable(voicing([52, 58], [62, 65, 69]))).toBe(true)
  })
})

describe('低音側の濁り', () => {
  it('長3度を E3(52) より下に置いたら落とす', () => {
    expect(isPlayable(voicing([45, 49]))).toBe(false) // A2 + C#3
  })

  it('同じ長3度でも E3 以上なら通る', () => {
    expect(isPlayable(voicing([52, 56]))).toBe(true)
  })

  it('低い位置でも広い音程なら通る。これが Powell が低く弾ける理由', () => {
    expect(isPlayable(voicing([41, 51]))).toBe(true) // F2 + Eb3 = 短7度
  })
})

describe('短9度の衝突', () => {
  it('同じ手の中の短9度は落とす', () => {
    expect(isPlayable(voicing([60, 73]))).toBe(false)
  })
})

describe('checkPlayability は理由を返す', () => {
  it('落ちた理由が1つ以上取れる', () => {
    const issues = checkPlayability(voicing([41, 58]))
    expect(issues.length).toBeGreaterThan(0)
    expect(typeof issues[0].code).toBe('string')
  })

  it('問題なければ空配列', () => {
    expect(checkPlayability(voicing([52, 58], [62, 65]))).toEqual([])
  })
})
