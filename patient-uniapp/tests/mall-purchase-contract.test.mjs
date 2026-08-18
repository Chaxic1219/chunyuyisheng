import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('小程序购买只提交 SKU 且不完成 Mock 支付', () => {
  const api = fs.readFileSync(new URL('../src/api/servicePackage.ts', import.meta.url), 'utf8')
  const pay = fs.readFileSync(new URL('../src/utils/servicePayFlow.ts', import.meta.url), 'utf8')
  const detail = fs.readFileSync(new URL('../src/pages/services/detail.vue', import.meta.url), 'utf8')
  assert.match(api, /skuId/)
  assert.match(api, /componentSummary/)
  assert.doesNotMatch(pay, /mockCompletePay/)
  assert.match(detail, /selectedSku|skuId/)
})
