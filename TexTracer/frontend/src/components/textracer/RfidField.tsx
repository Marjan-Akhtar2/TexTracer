import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Radio, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputCls } from "@/components/textracer/ui";

export const RFID_UID_PATTERN = /^[0-9A-F]{8,20}$/;

type InputKind = "waiting" | "scanner" | "manual";

/**
 * RFID UID field. A reader that presents itself to the computer as a keyboard types the tag UID into the focused
 * field in a fast burst followed by Enter; this component focuses itself, recognises that burst and reports
 * "Tag detected by scanner". It never invents a UID. Slowly typed or pasted values are labelled as manual entry.
 * (Readers that post directly to the backend, such as the ESP32 units, are not visible to the browser.)
 */
export function RfidField({ id, value, onChange, disabled, autoFocus = true, onScannerDetect }: {
  id: string; value: string; onChange: (uid: string) => void; disabled?: boolean; autoFocus?: boolean; onScannerDetect?: (uid: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const last = useRef(0);
  const burst = useRef(0);
  const [kind, setKind] = useState<InputKind>("waiting");
  const [focused, setFocused] = useState(false);

  useEffect(() => { if (autoFocus && !disabled) ref.current?.focus(); }, [autoFocus, disabled]);
  useEffect(() => { if (!value) { setKind("waiting"); burst.current = 0; } }, [value]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const now = performance.now();
    if (e.key.length === 1) {
      burst.current = now - last.current < 60 ? burst.current + 1 : 0;
      last.current = now;
    } else if (e.key === "Enter") {
      const clean = value.trim().toUpperCase();
      if (burst.current >= 5 && RFID_UID_PATTERN.test(clean)) { setKind("scanner"); onScannerDetect?.(clean); }
    }
  }

  function onInput(raw: string) {
    const clean = raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 20);
    onChange(clean);
    if (!clean) { setKind("waiting"); return; }
    setKind(burst.current >= 5 && clean.length >= 8 ? "scanner" : "manual");
  }

  const status = disabled ? "Scanner input disabled" : kind === "scanner" ? "Tag detected by scanner" : kind === "manual" ? "Entered manually" : focused ? "Ready — present the tag to the reader" : "Click the field, then present the tag";
  return (
    <div>
      <div className="relative">
        <input ref={ref} id={id} value={value} disabled={disabled} autoComplete="off" spellCheck={false} inputMode="text"
          onChange={(e) => onInput(e.target.value)} onKeyDown={onKeyDown} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder="Present the RFID tag to the reader" className={cn(inputCls, "pr-9 font-mono uppercase tracking-wider")} />
        {value && !disabled && (
          <button type="button" aria-label="Clear UID" onClick={() => { onChange(""); setKind("waiting"); ref.current?.focus(); }}
            className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        )}
      </div>
      <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs", kind === "scanner" ? "font-medium text-success" : "text-muted-foreground")} role="status">
        <Radio className="h-3.5 w-3.5" />{status}
      </p>
    </div>
  );
}
