import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, Check, Globe } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { normalizeLocale, type SupportedLocale } from "../i18n";

const languageOptions = [
  { locale: "en", translationKey: "languageSwitcher.options.en" },
  { locale: "zh-CN", translationKey: "languageSwitcher.options.zhCN" },
  { locale: "zh-TW", translationKey: "languageSwitcher.options.zhTW" },
  { locale: "ja", translationKey: "languageSwitcher.options.ja" },
] as const satisfies ReadonlyArray<{ locale: SupportedLocale; translationKey: string }>;

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const currentLocale = normalizeLocale(i18n.resolvedLanguage) ?? "en";
  const selectedIndex = languageOptions.findIndex((option) => option.locale === currentLocale);

  useEffect(() => {
    if (open) itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex, open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectLanguage = (locale: SupportedLocale) => {
    setOpen(false);
    void i18n.changeLanguage(locale);
    triggerRef.current?.focus();
  };

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }

    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = (focusedIndex + 1) % languageOptions.length;
        break;
      case "ArrowUp":
        nextIndex = (focusedIndex - 1 + languageOptions.length) % languageOptions.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = languageOptions.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    setFocusedIndex(nextIndex);
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("languageSwitcher.triggerLabel")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggleMenu}
        className="flex h-8 w-8 shrink-0 items-center justify-center gap-0.5 rounded-full border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50"
      >
        <Globe size={15} weight="bold" aria-hidden="true" />
        <CaretDown size={9} weight="bold" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("languageSwitcher.triggerLabel")}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-10 z-[70] min-w-44 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-xl"
        >
          {languageOptions.map((option, index) => {
            const selected = option.locale === currentLocale;
            return (
              <button
                key={option.locale}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={index === focusedIndex ? 0 : -1}
                lang={option.locale}
                onFocus={() => setFocusedIndex(index)}
                onClick={() => selectLanguage(option.locale)}
                className="flex w-full items-center justify-between gap-4 rounded-md px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              >
                <span>{t(option.translationKey)}</span>
                {selected ? <Check size={15} weight="bold" aria-hidden="true" /> : <span className="w-[15px]" />}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
