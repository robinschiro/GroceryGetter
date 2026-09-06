import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export type ToastVariant = "success" | "info" | "error";

export type ToastNotification = {
  id: number;
  message: string;
  variant: ToastVariant;
  duration?: number;
};

export function Toast({
  notification,
  onDismiss
}: {
  notification: ToastNotification;
  onDismiss: () => void;
}) {
  const onDismissRef = useRef(onDismiss);
  const duration = notification.duration ?? (notification.variant === "error" ? 8000 : 5000);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(timeoutId);
  }, [duration, notification.id]);

  return (
    <div
      className={`toast toast-${notification.variant}`}
      role={notification.variant === "error" ? "alert" : "status"}
    >
      <span>{notification.message}</span>
      <button
        className="toast-dismiss"
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastRegion({
  notifications,
  dismiss
}: {
  notifications: ToastNotification[];
  dismiss: (id: number) => void;
}) {
  if (!notifications.length) return null;

  return (
    <div className="toast-region" aria-label="Notifications">
      {notifications.map((notification) => (
        <Toast
          key={notification.id}
          notification={notification}
          onDismiss={() => dismiss(notification.id)}
        />
      ))}
    </div>
  );
}
