import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import FileUploader from '../components/FileUploader'
import {
  createFileTransfer,
  uploadTransferFile,
  getSentTransfers,
  getInboxTransfers,
  getSignedDownloadUrl,
  deleteFileTransfer,
  type FileTransfer,
  type TransferFile,
} from '../lib/supabase'

// ─── helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date()
}

function fileIcon(contentType: string | null): string {
  if (!contentType) return '📎'
  if (contentType.startsWith('image/')) return '🖼️'
  if (contentType === 'application/pdf') return '📄'
  if (contentType.includes('word')) return '📝'
  if (contentType.includes('excel') || contentType.includes('spreadsheet') || contentType === 'text/csv') return '📊'
  if (contentType.includes('powerpoint') || contentType.includes('presentation')) return '📑'
  if (contentType.includes('zip')) return '🗜️'
  if (contentType === 'application/json' || contentType === 'text/plain') return '🗒️'
  return '📎'
}

// ─── TransferCard ────────────────────────────────────────────────────────────

interface TransferCardProps {
  transfer: FileTransfer
  mode: 'sent' | 'inbox'
  onDelete?: (id: string, files: TransferFile[]) => Promise<void>
}

function TransferCard({ transfer, mode, onDelete }: TransferCardProps) {
  const [downloading, setDownloading] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const expired = isExpired(transfer.expires_at)
  const files = transfer.files ?? []

  const handleDownload = async (file: TransferFile) => {
    setDownloading(file.id)
    const url = await getSignedDownloadUrl(file.storage_path)
    setDownloading(null)
    if (!url) {
      alert('Could not generate download link. Please try again.')
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = file.file_name
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className={`transfer-card ${expired ? 'transfer-expired' : ''}`}>
      <div className="transfer-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="transfer-card-meta">
          <span className="transfer-direction">
            {mode === 'sent' ? (
              <>📤 To: <strong>{transfer.recipient_email}</strong></>
            ) : (
              <>📥 From: <strong>{transfer.sender_email}</strong></>
            )}
          </span>
          <span className="transfer-date">{formatDate(transfer.created_at)}</span>
        </div>
        <div className="transfer-card-right">
          <span className={`transfer-badge transfer-badge-${expired ? 'expired' : transfer.status}`}>
            {expired ? 'Expired' : transfer.status}
          </span>
          <span className="transfer-file-count">
            {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
          <button className="transfer-expand-btn" title={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="transfer-card-body">
          {transfer.message && (
            <p className="transfer-message">
              <span className="transfer-message-label">Message:</span> {transfer.message}
            </p>
          )}

          {expired && (
            <p className="transfer-expired-notice">
              ⏰ This transfer expired on {formatDate(transfer.expires_at)} and files can no longer be downloaded.
            </p>
          )}

          <ul className="transfer-files-list">
            {files.map((file) => (
              <li key={file.id} className="transfer-file-row">
                <span className="transfer-file-icon">{fileIcon(file.content_type)}</span>
                <div className="transfer-file-info">
                  <span className="transfer-file-name">{file.file_name}</span>
                  {file.file_size != null && (
                    <span className="transfer-file-size">{formatBytes(file.file_size)}</span>
                  )}
                </div>
                {!expired && (
                  <button
                    className="transfer-download-btn"
                    onClick={() => handleDownload(file)}
                    disabled={downloading === file.id}
                    title="Download file"
                  >
                    {downloading === file.id ? '⏳' : '⬇️'} Download
                  </button>
                )}
              </li>
            ))}
          </ul>

          {mode === 'sent' && onDelete && (
            <button
              className="transfer-delete-btn"
              onClick={() => {
                if (confirm('Delete this transfer and remove all its files?')) {
                  onDelete(transfer.id, files)
                }
              }}
            >
              🗑️ Delete Transfer
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

type Tab = 'send' | 'inbox' | 'sent'

export default function TransfersPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('send')

  // Send form
  const [files, setFiles] = useState<File[]>([])
  const [recipientEmail, setRecipientEmail] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)
  const [formKey, setFormKey] = useState(0)

  // Inbox / Sent lists — loaded on demand when the tab is clicked
  const [inboxTransfers, setInboxTransfers] = useState<FileTransfer[]>([])
  const [sentTransfers, setSentTransfers] = useState<FileTransfer[]>([])
  const [loadingInbox, setLoadingInbox] = useState(false)
  const [loadingSent, setLoadingSent] = useState(false)

  // ── Tab switch ───────────────────────────────────────────────────────────
  const switchTab = async (tab: Tab) => {
    setActiveTab(tab)

    if (tab === 'inbox' && user?.email) {
      setLoadingInbox(true)
      const data = await getInboxTransfers(user.email)
      setInboxTransfers(data)
      setLoadingInbox(false)
    }

    if (tab === 'sent' && user?.id) {
      setLoadingSent(true)
      const data = await getSentTransfers(user.id)
      setSentTransfers(data)
      setLoadingSent(false)
    }
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.id || !user?.email) return

    if (files.length === 0) {
      setSendError('Please select at least one file.')
      return
    }
    if (!recipientEmail.trim()) {
      setSendError("Please enter the recipient's email address.")
      return
    }
    if (recipientEmail.toLowerCase().trim() === user.email.toLowerCase()) {
      setSendError('You cannot send files to yourself.')
      return
    }

    setSending(true)
    setSendError(null)
    setSendSuccess(false)

    // Use a stable ID for the storage folder (mirrors the DB transfer ID)
    const tempTransferId = crypto.randomUUID()

    const uploadedFiles: Array<{
      name: string
      size: number
      storagePath: string
      contentType: string
    }> = []

    for (const file of files) {
      const storagePath = await uploadTransferFile(file, user.id, tempTransferId)
      if (!storagePath) {
        setSendError(`Failed to upload "${file.name}". Please try again.`)
        setSending(false)
        return
      }
      uploadedFiles.push({
        name: file.name,
        size: file.size,
        storagePath,
        contentType: file.type || 'application/octet-stream',
      })
    }

    const transfer = await createFileTransfer(
      user.id,
      user.email,
      recipientEmail,
      message,
      uploadedFiles,
    )

    if (!transfer) {
      setSendError('Failed to create the transfer record. Please try again.')
      setSending(false)
      return
    }

    setSendSuccess(true)
    setSending(false)
    setFiles([])
    setRecipientEmail('')
    setMessage('')
    setFormKey((k) => k + 1)
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDeleteTransfer = async (transferId: string, transferFiles: TransferFile[]) => {
    const ok = await deleteFileTransfer(transferId, transferFiles)
    if (ok) {
      setSentTransfers((prev) => prev.filter((t) => t.id !== transferId))
    } else {
      alert('Failed to delete transfer. Please try again.')
    }
  }

  const inboxUnread = inboxTransfers.filter(
    (t) => t.status === 'pending' && !isExpired(t.expires_at)
  ).length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="transfers-page">
      <div className="transfers-header">
        <h2>📁 File Transfers</h2>
        <p className="transfers-subtitle">
          Securely share pictures and spec files with other users via their email address.
          Files are stored privately and expire after 7 days.
        </p>
      </div>

      {/* Tabs */}
      <div className="transfers-tabs">
        <button
          className={`transfers-tab ${activeTab === 'send' ? 'active' : ''}`}
          onClick={() => switchTab('send')}
        >
          📤 Send Files
        </button>
        <button
          className={`transfers-tab ${activeTab === 'inbox' ? 'active' : ''}`}
          onClick={() => switchTab('inbox')}
        >
          📥 Inbox
          {inboxUnread > 0 && <span className="transfers-badge">{inboxUnread}</span>}
        </button>
        <button
          className={`transfers-tab ${activeTab === 'sent' ? 'active' : ''}`}
          onClick={() => switchTab('sent')}
        >
          📋 Sent
        </button>
      </div>

      {/* ── SEND TAB ── */}
      {activeTab === 'send' && (
        <div className="transfers-panel">
          {sendSuccess && (
            <div className="transfer-success-banner">
              ✅ Files sent successfully! The recipient will see them in their Inbox when they log in.
            </div>
          )}

          <form className="send-form" onSubmit={handleSend} key={formKey}>
            <div className="send-form-field">
              <label htmlFor="recipient-email" className="send-form-label">
                Recipient Email *
              </label>
              <input
                id="recipient-email"
                type="email"
                className="send-form-input"
                placeholder="recipient@example.com"
                value={recipientEmail}
                onChange={(e) => {
                  setRecipientEmail(e.target.value)
                  setSendError(null)
                  setSendSuccess(false)
                }}
                required
                disabled={sending}
              />
            </div>

            <div className="send-form-field">
              <label htmlFor="transfer-message" className="send-form-label">
                Message{' '}
                <span className="send-form-optional">(optional)</span>
              </label>
              <textarea
                id="transfer-message"
                className="send-form-textarea"
                placeholder="Add a note for the recipient..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                disabled={sending}
              />
            </div>

            <div className="send-form-field">
              <label className="send-form-label">Files *</label>
              <FileUploader onFilesChange={setFiles} disabled={sending} />
            </div>

            {sendError && (
              <div className="transfer-error-banner">⚠️ {sendError}</div>
            )}

            <button
              type="submit"
              className="send-submit-btn"
              disabled={sending || files.length === 0 || !recipientEmail.trim()}
            >
              {sending
                ? 'Uploading & Sending…'
                : `📤 Send ${files.length > 0 ? `${files.length} file${files.length !== 1 ? 's' : ''}` : 'Files'}`}
            </button>
          </form>
        </div>
      )}

      {/* ── INBOX TAB ── */}
      {activeTab === 'inbox' && (
        <div className="transfers-panel">
          {loadingInbox ? (
            <div className="transfers-loading">
              <div className="loading-spinner-small" />
              <p>Loading your inbox…</p>
            </div>
          ) : inboxTransfers.length === 0 ? (
            <div className="transfers-empty">
              <span className="transfers-empty-icon">📭</span>
              <p>Your inbox is empty</p>
              <p className="transfers-empty-sub">
                Files sent to your email address will appear here.
              </p>
            </div>
          ) : (
            <div className="transfers-list">
              {inboxTransfers.map((t) => (
                <TransferCard key={t.id} transfer={t} mode="inbox" />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SENT TAB ── */}
      {activeTab === 'sent' && (
        <div className="transfers-panel">
          {loadingSent ? (
            <div className="transfers-loading">
              <div className="loading-spinner-small" />
              <p>Loading sent transfers…</p>
            </div>
          ) : sentTransfers.length === 0 ? (
            <div className="transfers-empty">
              <span className="transfers-empty-icon">📤</span>
              <p>No sent transfers yet</p>
              <p className="transfers-empty-sub">Transfers you send will appear here.</p>
            </div>
          ) : (
            <div className="transfers-list">
              {sentTransfers.map((t) => (
                <TransferCard
                  key={t.id}
                  transfer={t}
                  mode="sent"
                  onDelete={handleDeleteTransfer}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
