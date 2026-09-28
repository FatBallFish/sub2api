import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import enMessages from '../locales/en'
import zhMessages from '../locales/zh'

type LocaleMessages = Record<string, unknown>

const srcRoot = resolve(__dirname, '../../')
const scannedRoots = ['components', 'router', 'views'].map((dir) => join(srcRoot, dir))
const scanExtensions = new Set(['.ts', '.tsx', '.vue'])

function flattenKeys(value: unknown, prefix = ''): Set<string> {
  const keys = new Set<string>()
  if (!value || typeof value !== 'object') {
    return keys
  }

  for (const [key, child] of Object.entries(value as LocaleMessages)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const nested of flattenKeys(child, path)) {
        keys.add(nested)
      }
    } else {
      keys.add(path)
    }
  }
  return keys
}

function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      if (entry === '__tests__') continue
      out.push(...walkFiles(fullPath))
      continue
    }
    if (scanExtensions.has(extname(entry))) {
      out.push(fullPath)
    }
  }
  return out
}

function collectStaticKeys() {
  const keys = new Map<string, Set<string>>()
  const add = (key: string, file: string) => {
    if (!keys.has(key)) {
      keys.set(key, new Set())
    }
    keys.get(key)?.add(relative(srcRoot, file))
  }

  const translationCallPattern = /(?:^|[^\w$])(?:t|\$t)\(\s*['"]([^'"]+)['"]\s*(?=[,)])/g
  const routeMetaKeyPattern = /\b(?:titleKey|descriptionKey):\s*['"`]([^'"`$]+)['"`]/g

  for (const root of scannedRoots) {
    for (const file of walkFiles(root)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(translationCallPattern)) {
        add(match[1], file)
      }
      for (const match of source.matchAll(routeMetaKeyPattern)) {
        add(match[1], file)
      }
    }
  }

  return keys
}

function formatMissing(missing: Array<[string, Set<string>]>) {
  return missing
    .map(([key, files]) => `${key} (${Array.from(files).sort().join(', ')})`)
    .join('\n')
}

describe('static translation keys', () => {
  const staticKeys = collectStaticKeys()
  const localeKeys = {
    en: flattenKeys(enMessages),
    zh: flattenKeys(zhMessages)
  }

  it.each(Object.entries(localeKeys))('defines every statically referenced key in %s', (_locale, keys) => {
    const missing = Array.from(staticKeys.entries())
      .filter(([key]) => !keys.has(key))
      .sort(([a], [b]) => a.localeCompare(b))

    expect(formatMissing(missing)).toBe('')
  })
})
