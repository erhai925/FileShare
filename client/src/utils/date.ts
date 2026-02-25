/** 东八区北京时间（展示用） */
const TIMEZONE = 'Asia/Shanghai'

/**
 * 将接口返回的日期字符串按 UTC 解析（无 Z 或 + 时），再格式化为东八区北京时间
 * 服务端/SQLite 存的是 UTC（YYYY-MM-DD HH:mm:ss），前端统一按东八区显示
 */
function parseAsUTC(date: string | Date): Date {
  if (date instanceof Date) return date
  const s = String(date).trim()
  if (!s) return new Date(NaN)
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s)
  return new Date(s.replace(' ', 'T') + 'Z')
}

/**
 * 格式化为东八区北京时间日期时间字符串
 */
export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '-'
  const d = parseAsUTC(date as string | Date)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('zh-CN', { timeZone: TIMEZONE })
}

/**
 * 格式化为相对时间（如：3 分钟前）
 */
export function formatRelativeTime(date: string | Date): string {
  const now = new Date()
  const target = parseAsUTC(typeof date === 'string' ? date : date)
  const diff = now.getTime() - target.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} 天前`
  if (hours > 0) return `${hours} 小时前`
  if (minutes > 0) return `${minutes} 分钟前`
  return '刚刚'
}
