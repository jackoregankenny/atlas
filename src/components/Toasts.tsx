import { useEffect } from "react";
import { Check, Info, AlertTriangle } from "lucide-react";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
  ttl?: number;
}

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: Props) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.ttl === 0) return;
    const t = setTimeout(() => onDismiss(toast.id), toast.ttl ?? 3500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  const Icon =
    toast.kind === "success" ? Check : toast.kind === "error" ? AlertTriangle : Info;

  return (
    <div className={`toast toast-${toast.kind}`} onClick={() => onDismiss(toast.id)}>
      <Icon size={15} strokeWidth={2.2} className="toast-icon" />
      <span>{toast.text}</span>
    </div>
  );
}
