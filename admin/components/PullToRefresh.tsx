"use client";

import { useEffect, useRef } from "react";

const MOBILE_MQ = "(max-width: 1023px)";
const ARM_PX = 18;
const TRIGGER_PX = 84;
const MAX_VISUAL_PX = 108;

export default function PullToRefresh() {
  const labelRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    let enabled = mq.matches;
    let bound = false;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let armed = false;
    let travel = 0;
    let refreshing = false;
    let zone: HTMLElement | null = null;
    let pulled: HTMLElement[] = [];
    let settleTimer = 0;

    function setLabel(text: string) {
      if (labelRef.current) labelRef.current.textContent = text;
    }

    function applyShift(px: number) {
      document.documentElement.style.setProperty("--pull-y", `${px}px`);
    }

    function clearSources() {
      for (const el of pulled) el.classList.remove("is-pull-source");
      pulled = [];
    }

    function reset(immediate: boolean) {
      window.clearTimeout(settleTimer);
      if (immediate || pulled.length === 0) {
        document.documentElement.removeAttribute("data-pull");
        document.documentElement.style.removeProperty("--pull-y");
        clearSources();
        setLabel("");
        iconRef.current?.classList.remove("is-spin", "is-ready");
        return;
      }
      document.documentElement.dataset.pull = "settle";
      applyShift(0);
      settleTimer = window.setTimeout(() => reset(true), 240);
    }

    function markSources(source: HTMLElement) {
      clearSources();
      const main = source.closest("main");
      const targets: HTMLElement[] = [];
      if (main instanceof HTMLElement) targets.push(main);
      else {
        targets.push(source);
        const pageMain = document.querySelector("main");
        if (pageMain instanceof HTMLElement) targets.push(pageMain);
      }
      for (const el of targets) {
        el.classList.add("is-pull-source");
        pulled.push(el);
      }
    }

    function visibleZone(el: HTMLElement) {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.height >= 8 && rect.bottom > 0 && rect.top < window.innerHeight;
    }

    function zoneFromTouch(touch: Touch): HTMLElement | null {
      if (document.querySelector("[aria-modal='true']")) return null;
      const stack = document.elementsFromPoint(touch.clientX, touch.clientY);
      for (const node of stack) {
        if (!(node instanceof Element)) continue;
        const candidate = node.closest<HTMLElement>("[data-pull-refresh]");
        if (candidate && visibleZone(candidate)) return candidate;
      }
      return null;
    }

    /** Un ancêtre déjà défilé doit garder le geste : ne pas le transformer en refresh. */
    function pageAtTop(target: EventTarget | null) {
      let el = target instanceof Element ? target.parentElement : null;
      while (el) {
        if (el === document.body || el === document.documentElement) break;
        const oy = window.getComputedStyle(el).overflowY;
        if (
          (oy === "auto" || oy === "scroll") &&
          el.scrollHeight > el.clientHeight + 2 &&
          el.scrollTop > 1
        ) {
          return false;
        }
        el = el.parentElement;
      }
      const root = document.scrollingElement;
      return !root || root.scrollTop <= 1;
    }

    function releaseTracking() {
      tracking = false;
      armed = false;
      zone = null;
    }

    function onStart(event: TouchEvent) {
      if (!enabled || refreshing || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      const next = zoneFromTouch(touch);
      if (!next || !pageAtTop(target)) return;
      window.clearTimeout(settleTimer);
      if (document.documentElement.dataset.pull === "settle") reset(true);
      startX = touch.clientX;
      startY = touch.clientY;
      zone = next;
      tracking = true;
      armed = false;
      travel = 0;
    }

    function onMove(event: TouchEvent) {
      if (!tracking || refreshing || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!armed) {
        if (dy < 0 || (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) || !pageAtTop(event.target)) {
          releaseTracking();
          return;
        }
        if (dy < ARM_PX) return;
        if (!zone) return;
        armed = true;
        markSources(zone);
        document.documentElement.dataset.pull = "1";
        setLabel("Tirer pour actualiser");
      }
      if (event.cancelable) event.preventDefault();
      travel = Math.max(0, dy);
      applyShift(Math.min(MAX_VISUAL_PX, travel * 0.72));
      const ready = travel >= TRIGGER_PX;
      setLabel(ready ? "Relâcher pour actualiser" : "Tirer pour actualiser");
      iconRef.current?.classList.toggle("is-ready", ready);
    }

    function onEnd() {
      if (!tracking || refreshing) return;
      const shouldRefresh = armed && travel >= TRIGGER_PX;
      tracking = false;
      armed = false;
      zone = null;
      if (!shouldRefresh) {
        reset(false);
        return;
      }
      refreshing = true;
      document.documentElement.dataset.pull = "refresh";
      applyShift(56);
      setLabel("Actualisation…");
      iconRef.current?.classList.add("is-spin");
      iconRef.current?.classList.remove("is-ready");
      window.setTimeout(() => {
        window.location.reload();
      }, 160);
    }

    function onCancel() {
      if (!tracking || refreshing) return;
      tracking = false;
      armed = false;
      zone = null;
      reset(false);
    }

    function bind() {
      if (bound) return;
      document.addEventListener("touchstart", onStart, { passive: true });
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
      document.addEventListener("touchcancel", onCancel);
      bound = true;
    }

    function unbind() {
      if (!bound) return;
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      bound = false;
    }

    function onMq() {
      enabled = mq.matches;
      if (enabled) bind();
      else {
        unbind();
        reset(true);
      }
    }

    mq.addEventListener("change", onMq);
    if (enabled) bind();

    return () => {
      mq.removeEventListener("change", onMq);
      unbind();
      reset(true);
    };
  }, []);

  return (
    <div className="pull-refresh-cue" role="status" aria-live="polite">
      <span className="pull-refresh-cue-inner">
        <span ref={iconRef} className="pull-refresh-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </span>
        <span ref={labelRef} />
      </span>
    </div>
  );
}
