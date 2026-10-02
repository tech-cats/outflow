#!/usr/bin/env node
/**
 * 下载免费的 DB-IP Country Lite IP 库（CC BY 4.0，每月更新），供自托管时识别请求地区。
 * Cloudflare 部署不需要：边缘自带国家信息。
 *
 *   node scripts/geoip-download.mjs [输出目录，默认 ./data/geoip]
 *   然后设置 GEO_MMDB_PATH=<输出目录>/dbip-country-lite.mmdb
 *
 * 建议每月执行一次（如 cron）以更新数据。
 */
import { createWriteStream, mkdirSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

const outDir = resolve(process.argv[2] ?? 'data/geoip')
mkdirSync(outDir, { recursive: true })
const target = join(outDir, 'dbip-country-lite.mmdb')

// 当月文件可能尚未发布，依次尝试当月与上月
const months = [0, 1].map((back) => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - back)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
})

for (const m of months) {
  const url = `https://download.db-ip.com/free/dbip-country-lite-${m}.mmdb.gz`
  console.log(`下载 ${url}`)
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    console.log(`  ${res.status}，尝试上一个月`)
    continue
  }
  const tmp = target + '.tmp'
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmp))
  renameSync(tmp, target)
  console.log(`✔ 已保存到 ${target}\n  请设置 GEO_MMDB_PATH=${target}`)
  console.log('  数据来源：IP Geolocation by DB-IP (https://db-ip.com)，CC BY 4.0')
  process.exit(0)
}
console.error('下载失败')
process.exit(1)
