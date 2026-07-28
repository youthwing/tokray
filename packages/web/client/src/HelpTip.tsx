import { Info } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
}

export function HelpTip({ content, label }: { content: string; label?: string }) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>();

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const tooltipWidth = Math.min(240, window.innerWidth - 16);
    const left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, rect.left + rect.width / 2 - tooltipWidth / 2));
    const placement = rect.top >= 96 ? 'above' : 'below';
    setPosition({
      left,
      top: placement === 'above' ? rect.top - 8 : rect.bottom + 8,
      placement,
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="term-help"
        aria-label={label ?? content}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <Info size={12} aria-hidden="true" />
      </button>
      {open && position && createPortal(
        <span
          id={id}
          role="tooltip"
          className={`term-tooltip term-tooltip-${position.placement}`}
          style={{ left: position.left, top: position.top }}
        >
          {content}
        </span>,
        document.body,
      )}
    </>
  );
}
