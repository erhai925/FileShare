import api from './api'

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
  realName?: string
}

export interface AuthResponse {
  success: boolean
  message: string
  data: {
    token: string
    user: {
      id: number
      username: string
      email: string
      realName?: string
      role: string
      avatar?: string
    }
  }
}

export const authService = {
  login: async (data: LoginRequest) => {
    return api.post<AuthResponse>('/auth/login', data)
  },
  
  register: async (data: RegisterRequest) => {
    return api.post('/auth/register', data)
  },
  
  getMe: async () => {
    return api.get('/auth/me')
  },
  
  changePassword: async (oldPassword: string, newPassword: string) => {
    return api.post('/auth/change-password', { oldPassword, newPassword })
  }
}





