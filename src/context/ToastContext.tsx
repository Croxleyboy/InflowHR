import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error') => void
  showError: (message: string) => void
  showSuccess: (message: string) => void
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
  showError: () => {},
  showSuccess: () => {},
})

export const useToast = () => useContext(ToastContext)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  const showError = useCallback((msg: string) => showToast(msg, 'error'), [showToast])
  const showSuccess = useCallback((msg: string) => showToast(msg, 'success'), [showToast])

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess }}>
      {children}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400 }}>
          {toasts.map(t => (
            <div
              key={t.id}
              onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              style={{
                padding: '12px 20px',
                borderRadius: 10,
                background: t.type === 'error' ? '#c62828' : '#2e7d32',
                color: '#fff',
                fontSize: 14,
                fontWeight: 500,
                boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                cursor: 'pointer',
                animation: 'toast-in 0.3s ease-out',
                lineHeight: 1.4,
              }}
            >
              {t.type === 'error' ? '⚠ ' : '✓ '}{t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}
