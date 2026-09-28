import { useEffect, useRef, useState } from "react";

export interface FileAttachmentInfo {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  nextChunkIndex: number;
  totalChunks: number;
  isOutgoing: boolean;
}

interface FileAttachmentProps {
  info: FileAttachmentInfo;
  onDownload: () => void;
  onLoadPreview: () => Promise<string | null>;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry?: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Ожидание…";
    case "sending":
      return "Отправка…";
    case "receiving":
      return "Приём…";
    case "completed":
      return "Готово";
    case "failed":
      return "Ошибка";
    case "paused":
      return "Пауза";
    case "cancelled":
      return "Отменено";
    default:
      return status;
  }
}

export function FileAttachment({
  info,
  onDownload,
  onLoadPreview,
  onPause,
  onResume,
  onCancel,
  onRetry,
}: FileAttachmentProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const attemptedPreview = useRef(false);
  const isImage = info.mimeType.startsWith("image/");

  useEffect(() => {
    if (!isImage || info.status !== "completed" || attemptedPreview.current) return;
    attemptedPreview.current = true;
    void onLoadPreview().then((url) => {
      if (url) setPreviewUrl(url);
    });
  }, [isImage, info.status, onLoadPreview]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const progress =
    info.totalChunks > 0 ? Math.round((info.nextChunkIndex / info.totalChunks) * 100) : 0;
  const inProgress = info.status === "sending" || info.status === "receiving";
  const isDone = info.status === "completed";
  const isCancelled = info.status === "cancelled";

  const canPause = info.isOutgoing && (info.status === "sending" || info.status === "pending");
  const canResume =
    info.status === "paused" ||
    (!info.isOutgoing && (info.status === "receiving" || info.status === "failed"));
  const canRetry = info.isOutgoing && (info.status === "failed" || info.status === "cancelled") && !!onRetry;
  const canCancel = !isDone && !isCancelled && !canRetry;

  return (
    <div className="file-attachment">
      {isImage && previewUrl ? (
        <a href={previewUrl} onClick={(e) => e.preventDefault()} className="file-attachment-thumb-wrap">
          <img src={previewUrl} alt={info.fileName} className="file-attachment-thumb" />
        </a>
      ) : (
        <span className="file-attachment-icon">📎</span>
      )}
      <div className="file-attachment-body">
        <div className="file-attachment-name">{info.fileName}</div>
        <div className="file-attachment-meta">
          {formatSize(info.sizeBytes)} · {statusLabel(info.status)}
          {inProgress || info.status === "paused" ? ` (${info.nextChunkIndex}/${info.totalChunks})` : ""}
        </div>
        {(inProgress || info.status === "paused") && (
          <div className="file-attachment-progress">
            <div className="file-attachment-progress-bar" style={{ width: `${progress}%` }} />
          </div>
        )}
        <div className="file-attachment-actions">
          {isDone && (
            <button type="button" className="secondary" onClick={onDownload}>
              Скачать
            </button>
          )}
          {canPause && (
            <button type="button" className="secondary" onClick={onPause}>
              Пауза
            </button>
          )}
          {canResume && (
            <button type="button" className="secondary" onClick={onResume}>
              Продолжить
            </button>
          )}
          {canRetry && (
            <button type="button" className="secondary" onClick={onRetry}>
              Повторить
            </button>
          )}
          {canCancel && (
            <button type="button" className="secondary" onClick={onCancel}>
              Отмена
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
