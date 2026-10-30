import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error' | 'warning'
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'warning') => void
  showError: (message: string) => void
  showSuccess: (message: string) => void
  showWarning: (message: string) => void
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
  showError: () => {},
  showSuccess: () => {},
  showWarning: () => {},
})

export const useToast = () => useContext(ToastContext)

let nextId = 0

const TOAST_BG: Record<Toast['type'], string> = {
  error: '#c62828',
  success: '#2e7d32',
  warning: '#e65100',
}

const TOAST_ICON: Record<Toast['type'], string> = {
  error: '⚠ ',
  success: '✓ ',
  warning: '⚠ ',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning' = 'error') => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, message, type }])
    if (type !== 'warning') {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
    }
  }, [])

  const showError = useCallback((msg: string) => showToast(msg, 'error'), [showToast])
  const showSuccess = useCallback((msg: string) => showToast(msg, 'success'), [showToast])
  const showWarning = useCallback((msg: string) => showToast(msg, 'warning'), [showToast])

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess, showWarning }}>
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
                background: TOAST_BG[t.type],
                color: '#fff',
                fontSize: 14,
                fontWeight: 500,
                boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                cursor: 'pointer',
                animation: 'toast-in 0.3s ease-out',
                lineHeight: 1.4,
              }}
            >
              {TOAST_ICON[t.type]}{t.message}{t.type === 'warning' && <span style={{ marginLeft: 8, opacity: 0.7, fontSize: 12 }}>✕</span>}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}
