import { useEffect, useRef, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  Database,
  FilePlus2,
  Folder,
  FolderPlus,
  Keyboard,
  Library as LibraryIcon,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import type { Collection, Device } from "../types";
import type { Theme } from "../hooks/useTheme";
import type { View } from "../state/useAppEvents";
import type { StatusFilter } from "../state/useFilters";
import { Popover, MenuItem, MenuSeparator, MenuLabel } from "./Popover";
import { HoverPill } from "./HoverPill";

interface SidebarProps {
  view: View;
  setView: (v: View) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (s: StatusFilter) => void;
  statusCounts: { all: number; unread: number; reading: number; finished: number };
  folders: Collection[];
  activeCollectionId: number | null;
  onSelectCollection: (id: number) => void;
  onCreateFolder: (name: string) => Promise<number>;
  onDeleteFolder: (id: number) => Promise<void>;
  onRenameFolder: (id: number, name: string) => Promise<void>;
  devices: Device[];
  importing: boolean;
  onPickImport: (m: "files" | "folder") => void;
  onOpenPalette: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onOpenShortcuts: () => void;
}

export function Sidebar({
  view,
  setView,
  statusFilter,
  setStatusFilter,
  statusCounts,
  folders,
  activeCollectionId,
  onSelectCollection,
  onCreateFolder,
  onDeleteFolder,
  onRenameFolder,
  devices,
  importing,
  onPickImport,
  onOpenPalette,
  theme,
  setTheme,
  onOpenShortcuts,
}: SidebarProps) {
  const inLib = view === "library";
  return (
    <aside className="sidebar" data-tauri-drag-region>
      <button
        className="sidebar-search"
        onClick={onOpenPalette}
        title="Search library"
      >
        <Search size={13} strokeWidth={2} />
        <span>Search</span>
        <kbd className="kbd">⌘K</kbd>
      </button>

      <HoverPill
        className="sidebar-scroll"
        selector="button"
        skip=".active"
        activeSelector="nav button.active, .folder-row.active .folder-main"
      >
        <nav>
          <button
            className={inLib && statusFilter === "all" ? "active" : ""}
            onClick={() => {
              setStatusFilter("all");
            }}
          >
            <LibraryIcon size={14} strokeWidth={2} />
            <span>All books</span>
            <span className="count">{statusCounts.all}</span>
          </button>
          <button
            className={inLib && statusFilter === "reading" ? "active" : ""}
            onClick={() => setStatusFilter("reading")}
          >
            <BookOpen size={14} strokeWidth={2} />
            <span>Reading</span>
            <span className="count">{statusCounts.reading}</span>
          </button>
          <button
            className={inLib && statusFilter === "unread" ? "active" : ""}
            onClick={() => setStatusFilter("unread")}
          >
            <Circle size={14} strokeWidth={2} />
            <span>Unread</span>
            <span className="count">{statusCounts.unread}</span>
          </button>
          <button
            className={inLib && statusFilter === "finished" ? "active" : ""}
            onClick={() => setStatusFilter("finished")}
          >
            <CheckCircle2 size={14} strokeWidth={2} />
            <span>Finished</span>
            <span className="count">{statusCounts.finished}</span>
          </button>
        </nav>

        {devices.length > 0 && (
          <>
            <div className="sidebar-section-title">Devices</div>
            <nav className="sidebar-devices">
              {devices.map((d) => (
                <div key={d.id} className="sidebar-device" title={d.root}>
                  <span className="device-dot" />
                  <span>{d.name}</span>
                </div>
              ))}
            </nav>
          </>
        )}

        <FoldersSection
          folders={folders}
          activeId={view === "collection" ? activeCollectionId : null}
          onSelect={onSelectCollection}
          onCreate={onCreateFolder}
          onDelete={onDeleteFolder}
          onRename={onRenameFolder}
        />
      </HoverPill>

      <div className="sidebar-footer">
        <Popover
          align="start"
          side="top"
          trigger={
            <button className="primary sb-import" disabled={importing}>
              <Plus size={13} strokeWidth={2.4} />
              <span>Import</span>
              <span className="sb-chevron">▾</span>
            </button>
          }
        >
          {(close) => (
            <div className="menu">
              <MenuItem
                icon={<FilePlus2 size={14} strokeWidth={2} />}
                label="Files…"
                shortcut="⌘I"
                onClick={() => {
                  close();
                  onPickImport("files");
                }}
              />
              <MenuItem
                icon={<FolderPlus size={14} strokeWidth={2} />}
                label="Folder…"
                shortcut="⌘⇧I"
                onClick={() => {
                  close();
                  onPickImport("folder");
                }}
              />
              <MenuSeparator />
              <MenuItem
                icon={<Database size={14} strokeWidth={2} />}
                label="From Calibre…"
                disabled
              />
            </div>
          )}
        </Popover>

        <div className="sidebar-row">
          <button
            className={`sb-mini ${view === "settings" ? "active" : ""}`}
            onClick={() => setView("settings")}
            title="Settings"
          >
            <SettingsIcon size={13} strokeWidth={2} />
          </button>
          <Popover
            align="start"
            side="top"
            trigger={
              <button className="sb-mini" title="Theme">
                {theme === "light" ? (
                  <Sun size={13} strokeWidth={2} />
                ) : theme === "dark" ? (
                  <Moon size={13} strokeWidth={2} />
                ) : (
                  <Monitor size={13} strokeWidth={2} />
                )}
              </button>
            }
          >
            {(close) => (
              <div className="menu">
                <MenuLabel>Theme</MenuLabel>
                <MenuItem
                  icon={<Moon size={14} strokeWidth={2} />}
                  label="Dark"
                  active={theme === "dark"}
                  onClick={() => {
                    setTheme("dark");
                    close();
                  }}
                />
                <MenuItem
                  icon={<Sun size={14} strokeWidth={2} />}
                  label="Light"
                  active={theme === "light"}
                  onClick={() => {
                    setTheme("light");
                    close();
                  }}
                />
                <MenuItem
                  icon={<Monitor size={14} strokeWidth={2} />}
                  label="System"
                  active={theme === "system"}
                  onClick={() => {
                    setTheme("system");
                    close();
                  }}
                />
              </div>
            )}
          </Popover>
          <button className="sb-mini" onClick={onOpenShortcuts} title="Shortcuts (?)">
            <Keyboard size={13} strokeWidth={2} />
          </button>
        </div>
      </div>
    </aside>
  );
}

interface FoldersSectionProps {
  folders: Collection[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onCreate: (name: string) => Promise<number>;
  onDelete: (id: number) => Promise<void>;
  onRename: (id: number, name: string) => Promise<void>;
}

function FoldersSection({
  folders,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: FoldersSectionProps) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);
  useEffect(() => {
    if (renamingId != null) renameRef.current?.focus();
  }, [renamingId]);

  const commitAdd = async () => {
    const v = name.trim();
    if (!v) { setAdding(false); return; }
    await onCreate(v);
    setName("");
    setAdding(false);
  };

  const cancelAdd = () => { setName(""); setAdding(false); };

  const commitRename = async () => {
    const v = renameVal.trim();
    if (v && renamingId != null) await onRename(renamingId, v);
    setRenamingId(null);
    setRenameVal("");
  };

  return (
    <>
      <div className="sidebar-section-title sidebar-section-title-row">
        <span>Collections</span>
        <button
          className="section-add"
          onClick={() => setAdding(true)}
          title="New collection"
        >
          <Plus size={11} strokeWidth={2.4} />
        </button>
      </div>
      <nav className="sidebar-folders">
        {folders.map((f) => {
          const isRenaming = renamingId === f.id;
          return (
            <div
              key={f.id}
              className={`folder-row ${activeId === f.id ? "active" : ""}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setRenamingId(f.id);
                setRenameVal(f.name);
              }}
            >
              {isRenaming ? (
                <div className="folder-edit-row">
                  <input
                    ref={renameRef}
                    className="folder-edit-input"
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") {
                        setRenamingId(null);
                        setRenameVal("");
                      }
                    }}
                  />
                  <button
                    className="folder-edit-confirm"
                    onClick={commitRename}
                    disabled={!renameVal.trim()}
                    title="Rename"
                  >
                    <Check size={11} strokeWidth={2.6} />
                  </button>
                  <button
                    className="folder-edit-cancel"
                    onClick={() => { setRenamingId(null); setRenameVal(""); }}
                    title="Cancel"
                  >
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </div>
              ) : (
                <button className="folder-main" onClick={() => onSelect(f.id)}>
                  <Folder size={12} strokeWidth={2} />
                  <span>{f.name}</span>
                  <span className="count">{f.count}</span>
                </button>
              )}
              {!isRenaming && (
                <button
                  className="folder-delete"
                  title="Delete collection"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await ask(`Delete "${f.name}"?`, {
                      title: "Delete collection",
                      kind: "warning",
                      okLabel: "Delete",
                      cancelLabel: "Cancel",
                    });
                    if (ok) onDelete(f.id);
                  }}
                >
                  <Trash2 size={11} strokeWidth={2} />
                </button>
              )}
            </div>
          );
        })}
        {adding && (
          <div className="folder-new-row">
            <FolderPlus size={12} strokeWidth={2} className="folder-new-icon" />
            <input
              ref={inputRef}
              className="folder-edit-input"
              value={name}
              placeholder="Collection name…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAdd();
                else if (e.key === "Escape") cancelAdd();
              }}
            />
            <button
              className="folder-edit-confirm"
              onClick={commitAdd}
              disabled={!name.trim()}
              title="Create"
            >
              <Check size={11} strokeWidth={2.6} />
            </button>
            <button
              className="folder-edit-cancel"
              onClick={cancelAdd}
              title="Cancel"
            >
              <X size={11} strokeWidth={2.4} />
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
