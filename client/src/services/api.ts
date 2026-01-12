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
    console.log('API 请求 - URL:', config.url);
    console.log('API 请求 - Token:', token ? '存在' : '不存在');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
      console.log('API 请求 - 已添加 Authorization 头');
    } else {
      console.warn('API 请求 - 没有 token，请求可能失败');
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
    console.error('API 响应错误 - URL:', error.config?.url);
    console.error('API 响应错误 - 状态码:', error.response?.status);
    console.error('API 响应错误 - 错误信息:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.warn('API 响应错误 - 401 未授权，清除 token 并跳转到登录页');
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(error.response?.data || error)
  }
)

export default api





