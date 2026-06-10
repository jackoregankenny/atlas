import { FileType2, Folder, Send, Sparkles, Tablet, Trash2, X } from "lucide-react";
import type { Collection, Device } from "../types";
import { Popover, MenuItem, MenuLabel } from "./Popover";

interface Props {
  count: number;
  folders: Collection[];
  devices: Device[];
  batchRunning: boolean;
  onBulkEnrich: () => void;
  onBulkAddToCollection: (id: number) => void;
  onBulkSendToDevice: (device: Device) => void;
  onClear: () => void;
  removeLabel?: string;
  onBulkRemove?: () => Promise<void>;
}

export function SelectionBar({
  count,
  folders,
  devices,
  batchRunning,
  onBulkEnrich,
  onBulkAddToCollection,
  onBulkSendToDevice,
  onClear,
  removeLabel,
  onBulkRemove,
}: Props) {
  return (
    <div className="selection-bar">
      <span className="sel-count">
        <span className="sel-count-num">{count}</span>
        {" "}{count === 1 ? "book" : "books"} selected
      </span>
      <div className="sel-sep" />
      <div className="sel-actions">
        {folders.length > 0 && (
          <Popover
            align="center"
            side="top"
            trigger={
              <button className="sel-btn">
                <Folder size={13} strokeWidth={2} />
                <span>Add to collection</span>
              </button>
            }
          >
            {(close) => (
              <div className="menu">
                <MenuLabel>Add to collection</MenuLabel>
                {folders.map((f) => (
                  <MenuItem
                    key={f.id}
                    icon={<Folder size={14} strokeWidth={2} />}
                    label={f.name}
                    onClick={() => { onBulkAddToCollection(f.id); close(); }}
                  />
                ))}
              </div>
            )}
          </Popover>
        )}
        <button
          className="sel-btn"
          onClick={onBulkEnrich}
          disabled={batchRunning}
          title={batchRunning ? "Enrichment already running" : "Enrich selected books"}
        >
          <Sparkles size={13} strokeWidth={2} />
          <span>Enrich</span>
        </button>
        <Popover
          align="center"
          side="top"
          trigger={
            <button className="sel-btn">
              <FileType2 size={13} strokeWidth={2} />
              <span>Convert</span>
            </button>
          }
        >
          {() => (
            <div className="menu">
              <MenuLabel>Convert to</MenuLabel>
              <MenuItem label="KEPUB (Kobo) — coming soon" disabled />
              <MenuItem label="AZW3 (Kindle) — coming soon" disabled />
              <MenuItem label="PDF — coming soon" disabled />
              <MenuItem label="Markdown — coming soon" disabled />
            </div>
          )}
        </Popover>
        <Popover
          align="center"
          side="top"
          trigger={
            <button className="sel-btn">
              <Send size={13} strokeWidth={2} />
              <span>Send to device</span>
            </button>
          }
        >
          {(close) => (
            <div className="menu">
              <MenuLabel>Send to device</MenuLabel>
              {devices.length === 0 ? (
                <>
                  <div className="menu-empty">No device connected</div>
                  <div className="menu-hint">
                    Plug in a Kindle or Kobo via USB. Kindles from 2023 on
                    connect via MTP, which Atlas can't see yet — use
                    Amazon's Send to Kindle for those.
                  </div>
                </>
              ) : (
                devices.map((d) => (
                  <MenuItem
                    key={d.id}
                    icon={<Tablet size={14} strokeWidth={2} />}
                    label={d.name}
                    onClick={() => { onBulkSendToDevice(d); close(); }}
                  />
                ))
              )}
            </div>
          )}
        </Popover>
        {removeLabel && onBulkRemove && (
          <button className="sel-btn sel-btn-danger" onClick={onBulkRemove}>
            <Trash2 size={13} strokeWidth={2} />
            <span>{removeLabel}</span>
          </button>
        )}
      </div>
      <div className="sel-sep" />
      <button className="sel-clear" onClick={onClear} title="Clear selection">
        <X size={13} strokeWidth={2.4} />
      </button>
    </div>
  );
}
