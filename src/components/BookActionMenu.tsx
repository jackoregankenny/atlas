import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Sparkles,
  Bookmark,
  Send,
  FileType2,
  Tablet,
  Copy as CopyIcon,
  Folder,
  Info,
  Trash2,
  Plus,
  X,
  Eye,
  Pencil,
  ExternalLink,
  Link2,
  Highlighter,
} from "lucide-react";
import { MenuItem, MenuSeparator, MenuLabel } from "./Popover";
import { Submenu } from "./ContextMenu";
import type { Book, Device } from "../types";

export interface BookActionHandlers {
  onRead: (b: Book) => void;
  onShowDetails?: (b: Book) => void;
  onToggleFinished: (b: Book) => void;
  onEnrich: (b: Book) => void;
  onAddTag: (id: number, name: string) => void;
  onRemoveTag: (id: number, name: string) => void;
  onCopyIsbn: (b: Book) => void;
  onReveal: (b: Book) => void;
  onDelete: (b: Book) => void;
  onSendDevice: (b: Book, device: Device) => void;
  onConvert?: (b: Book, fmt: "markdown" | "html" | "text") => void;
  onEditMetadata?: (b: Book) => void;
  onOpenOriginal?: (b: Book) => void;
  onCopyBookLink?: (b: Book) => void;
  onExportAnnotations?: (b: Book) => void;
  /** True if the book has at least one `role='original'` sidecar. */
  hasOriginal?: boolean;
}

interface Props {
  book: Book;
  enriching: boolean;
  close: () => void;
  /**
   * "full" — every action (default, used by right-click context menu)
   * "secondary" — only actions not already visible in the detail-panel button row
   */
  mode?: "full" | "secondary";
  devices: Device[];
  handlers: BookActionHandlers;
}

export function BookActionMenu({
  book,
  enriching,
  close,
  mode = "full",
  devices,
  handlers,
}: Props) {
  const full = mode === "full";
  const b = book;
  const finished = b.status === "finished";
  const h = handlers;

  return (
    <div className="menu">
      {full && (
        <>
          <MenuItem
            icon={<BookOpen size={14} strokeWidth={2.2} />}
            label={
              b.progress_percent && b.progress_percent > 0 && !finished
                ? `Continue · ${Math.round(b.progress_percent)}%`
                : finished
                ? "Re-read"
                : "Read"
            }
            disabled={!b.file_path}
            onClick={() => {
              h.onRead(b);
              close();
            }}
          />
          {h.onShowDetails && (
            <MenuItem
              icon={<Eye size={14} strokeWidth={2} />}
              label="Show details"
              onClick={() => {
                h.onShowDetails?.(b);
                close();
              }}
            />
          )}
          <MenuSeparator />
          <MenuItem
            icon={<CheckCircle2 size={14} strokeWidth={2} />}
            label={finished ? "Mark as unread" : "Mark as finished"}
            onClick={() => {
              h.onToggleFinished(b);
              close();
            }}
          />
          <MenuItem
            icon={<Sparkles size={14} strokeWidth={2} />}
            label="Enrich from Open Library"
            disabled={enriching}
            onClick={() => {
              h.onEnrich(b);
              close();
            }}
          />
        </>
      )}
      <Submenu icon={<Bookmark size={14} strokeWidth={2} />} label="Tags">
        <div className="menu">
          {b.tags.length === 0 && (
            <div className="menu-empty">No tags yet</div>
          )}
          {b.tags.map((t) => (
            <MenuItem
              key={t}
              icon={<X size={13} strokeWidth={2.4} />}
              label={t}
              onClick={() => h.onRemoveTag(b.id, t)}
            />
          ))}
          {b.tags.length > 0 && <MenuSeparator />}
          <AddTagInline onAdd={(name) => h.onAddTag(b.id, name)} />
        </div>
      </Submenu>
      <MenuSeparator />
      <Submenu icon={<Send size={14} strokeWidth={2} />} label="Send to device">
        <div className="menu">
          {devices.length === 0 ? (
            <>
              <MenuLabel>Connected devices</MenuLabel>
              <div className="menu-empty">No device connected</div>
              <MenuSeparator />
              <div className="menu-hint">
                Plug in a Kindle or Kobo via USB and it appears here.
                Kindles from 2023 on connect via MTP, which Atlas can't
                see yet — use Amazon's Send to Kindle for those.
              </div>
            </>
          ) : (
            <>
              <MenuLabel>Connected devices</MenuLabel>
              {devices.map((d) => (
                <MenuItem
                  key={d.id}
                  icon={<Tablet size={14} strokeWidth={2} />}
                  label={d.name}
                  disabled={!b.file_path}
                  onClick={() => {
                    h.onSendDevice(b, d);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </div>
      </Submenu>
      <Submenu icon={<FileType2 size={14} strokeWidth={2} />} label="Convert to">
        <div className="menu">
          <MenuItem
            label="Markdown"
            disabled={!b.file_path || !h.onConvert}
            onClick={() => {
              h.onConvert?.(b, "markdown");
              close();
            }}
          />
          <MenuItem
            label="HTML"
            disabled={!b.file_path || !h.onConvert}
            onClick={() => {
              h.onConvert?.(b, "html");
              close();
            }}
          />
          <MenuItem
            label="Plain text"
            disabled={!b.file_path || !h.onConvert}
            onClick={() => {
              h.onConvert?.(b, "text");
              close();
            }}
          />
        </div>
      </Submenu>
      <MenuSeparator />
      <MenuItem
        icon={<CopyIcon size={14} strokeWidth={2} />}
        label="Copy ISBN"
        disabled={!b.isbn}
        onClick={() => {
          h.onCopyIsbn(b);
          close();
        }}
      />
      <MenuItem
        icon={<Folder size={14} strokeWidth={2} />}
        label="Reveal in Finder"
        disabled={!b.file_path}
        onClick={() => {
          h.onReveal(b);
          close();
        }}
      />
      {h.onOpenOriginal && (
        <MenuItem
          icon={<ExternalLink size={14} strokeWidth={2} />}
          label="Open original"
          disabled={!h.hasOriginal}
          onClick={() => {
            h.onOpenOriginal?.(b);
            close();
          }}
        />
      )}
      {h.onCopyBookLink && (
        <MenuItem
          icon={<Link2 size={14} strokeWidth={2} />}
          label="Copy book link"
          onClick={() => {
            h.onCopyBookLink?.(b);
            close();
          }}
        />
      )}
      {h.onEditMetadata && (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<Pencil size={14} strokeWidth={2} />}
            label="Edit metadata…"
            onClick={() => {
              h.onEditMetadata?.(b);
              close();
            }}
          />
        </>
      )}
      {h.onExportAnnotations && (
        <MenuItem
          icon={<Highlighter size={14} strokeWidth={2} />}
          label="Export annotations…"
          onClick={() => {
            h.onExportAnnotations?.(b);
            close();
          }}
        />
      )}
      {full && h.onShowDetails && (
        <MenuItem
          icon={<Info size={14} strokeWidth={2} />}
          label="Book info"
          onClick={() => {
            h.onShowDetails?.(b);
            close();
          }}
        />
      )}
      <MenuSeparator />
      <MenuItem
        icon={<Trash2 size={14} strokeWidth={2} />}
        label="Remove from library"
        danger
        onClick={() => {
          if (confirm(`Remove "${b.title}" from library?`)) {
            h.onDelete(b);
          }
          close();
        }}
      />
    </div>
  );
}

function AddTagInline({ onAdd }: { onAdd: (name: string) => void }) {
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  // autofocus when the submenu containing this row mounts
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const commit = () => {
    const v = val.trim();
    if (!v) return;
    onAdd(v);
    setVal("");
    // Keep focus so users can add multiple tags in a row.
    inputRef.current?.focus();
  };

  return (
    <div className="menu-add-row" onMouseDown={(e) => e.stopPropagation()}>
      <Plus size={13} strokeWidth={2.4} className="menu-add-icon" />
      <input
        ref={inputRef}
        type="text"
        className="menu-add-input"
        placeholder="Add tag…"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setVal("");
            inputRef.current?.blur();
          }
        }}
      />
    </div>
  );
}
