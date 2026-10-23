import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { createQueryClient } from '@/api/queryClient'
import { AuthProvider } from '@/auth/AuthProvider'
import { ThemeController } from '@/components/ThemeController'
import { ToastViewport } from '@/components/ui/Toast'
import { router } from './router'

export function App() {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeController />
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
        <ToastViewport />
      </AuthProvider>
    </QueryClientProvider>
  )
}
