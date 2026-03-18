import { useRef, useState } from 'react'
import type { DragEvent, ChangeEvent } from 'react'

interface SelectedFile {
  file: File
  id: string
  preview?: string // data-URL for images
}

interface FileUploaderProps {
  onFilesChange: (files: File[]) => void
  disabled?: boolean
}

const ACCEPTED_TYPES = [
  'image/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

function fileIcon(file: File): string {
  const t = file.type
  if (t.startsWith('image/')) return '🖼️'
  if (t === 'application/pdf') return '📄'
  if (t.includes('word')) return '📝'
  if (t.includes('excel') || t.includes('spreadsheet') || t === 'text/csv') return '📊'
  if (t.includes('powerpoint') || t.includes('presentation')) return '📑'
  if (t === 'application/zip' || t === 'application/x-zip-compressed') return '🗜️'
  if (t === 'application/json' || t === 'text/plain') return '🗒️'
  return '📎'
}

export default function FileUploader({ onFilesChange, disabled }: FileUploaderProps) {
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming)
    const newErrors: string[] = []
    const valid: SelectedFile[] = []

    arr.forEach((file) => {
      // Avoid duplicates by name+size
      const dup = selectedFiles.find((f) => f.file.name === file.name && f.file.size === file.size)
      if (dup) return

      const entry: SelectedFile = { file, id: crypto.randomUUID() }
      if (isImage(file)) {
        const reader = new FileReader()
        reader.onload = (e) => {
          setSelectedFiles((prev) =>
            prev.map((sf) => (sf.id === entry.id ? { ...sf, preview: e.target?.result as string } : sf))
          )
        }
        reader.readAsDataURL(file)
      }
      valid.push(entry)
    })

    setErrors(newErrors)

    if (valid.length === 0) return
    const next = [...selectedFiles, ...valid]
    setSelectedFiles(next)
    onFilesChange(next.map((sf) => sf.file))
  }

  const removeFile = (id: string) => {
    const next = selectedFiles.filter((sf) => sf.id !== id)
    setSelectedFiles(next)
    onFilesChange(next.map((sf) => sf.file))
    setErrors([])
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    addFiles(e.dataTransfer.files)
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files)
    // Reset input so the same file can be re-added after removal
    e.target.value = ''
  }

  return (
    <div className="file-uploader">
      {/* Drop Zone */}
      <div
        className={`drop-zone ${dragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        aria-label="Click or drag files here to upload"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(',')}
          onChange={handleInputChange}
          style={{ display: 'none' }}
          disabled={disabled}
        />
        <span className="drop-zone-icon">📁</span>
        <p className="drop-zone-label">
          {dragging ? 'Drop files here' : 'Click or drag files here'}
        </p>
        <p className="drop-zone-hint">
          Images, PDFs, Office docs, ZIP, JSON, text
        </p>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="upload-errors">
          {errors.map((err, i) => (
            <p key={i} className="upload-error">⚠️ {err}</p>
          ))}
        </div>
      )}

      {/* File List */}
      {selectedFiles.length > 0 && (
        <ul className="upload-file-list">
          {selectedFiles.map((sf) => (
            <li key={sf.id} className="upload-file-item">
              {sf.preview ? (
                <img src={sf.preview} alt={sf.file.name} className="upload-thumb" />
              ) : (
                <span className="upload-file-icon">{fileIcon(sf.file)}</span>
              )}
              <div className="upload-file-info">
                <span className="upload-file-name" title={sf.file.name}>{sf.file.name}</span>
                <span className="upload-file-size">{formatBytes(sf.file.size)}</span>
              </div>
              {!disabled && (
                <button
                  className="upload-file-remove"
                  onClick={() => removeFile(sf.id)}
                  title="Remove file"
                  type="button"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
