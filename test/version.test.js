import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const readJson = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'))

test('package.json 與 manifest.json 版本一致', () => {
  assert.equal(readJson('../package.json').version, readJson('../manifest.json').version)
})
