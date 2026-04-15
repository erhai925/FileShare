import axios from 'axios'
import { useAuthStore } from '../stores/authStore'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response.data
  },
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    // 429 限流：不触发登出，仅提示用户稍后重试（避免与密码错误混淆）
    if (error.response?.status === 429) {
      const msg = typeof error.response?.data === 'object' ? error.response?.data?.message : error.response?.data
      return Promise.reject({ ...(error.response?.data || {}), message: msg || '请求过于频繁，请 15 分钟后再试' })
    }
    return Promise.reject(error.response?.data || error)
  }
)

export default api





