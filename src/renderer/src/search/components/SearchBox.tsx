/** 流光搜索 · 搜索框（hero 大搜索框 / 标题栏 mini 框） */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Icon } from './Icon';

export interface SearchBoxProps {
  variant?: 'hero' | 'mini';
  value: string;
  onChange: (value: string) => void;
  onSubmit: (query: string) => void;
  suggestions?: string[];
  loading?: boolean;
  placeholder?: string;
  engineLabel?: string;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onEscape?: () => void;
  className?: string;
}

export function SearchBox({
  variant = 'hero',
  value,
  onChange,
  onSubmit,
  suggestions = [],
  loading = false,
  placeholder = '搜索网页，或粘贴图片 / 文件链接…',
  engineLabel: engine,
  autoFocus = false,
  inputRef,
  onEscape,
  className,
}: SearchBoxProps) {
  const localRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? localRef;
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const open = variant === 'hero' && focused && !dismissed && suggestions.length > 0 && value.trim().length > 0;

  useEffect(() => {
    setActiveIndex(-1);
  }, [suggestions]);

  useEffect(() => {
    if (!open) setActiveIndex(-1);
  }, [open]);

  const submit = (raw?: string) => {
    const query = (raw ?? value).trim();
    setDismissed(true);
    setFocused(false);
    ref.current?.blur();
    if (query) onSubmit(query);
  };

  const pick = (text: string) => {
    onChange(text);
    submit(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && open) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && activeIndex >= 0) pick(suggestions[activeIndex]);
      else submit();
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setDismissed(true);
        return;
      }
      onEscape?.();
    }
  };

  const hero = variant === 'hero';

  return (
    <div className={`s-searchbox ${variant}${open ? ' open' : ''}${focused ? ' focused' : ''}${className ? ` ${className}` : ''}`}>
      <span className="s-searchbox-icon" aria-hidden="true">
        {loading ? <span className="s-spinner" /> : <Icon name="search" size={hero ? 20 : 15} />}
      </span>
      <input
        ref={ref}
        className="s-searchbox-input"
        value={value}
        type="text"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="搜索"
        onChange={(event) => {
          onChange(event.currentTarget.value);
          setDismissed(false);
        }}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => {
          // 延迟收起，允许点击建议项
          window.setTimeout(() => setFocused(false), 120);
        }}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <button
          type="button"
          className="s-searchbox-clear"
          aria-label="清空"
          title="清空"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('');
            setDismissed(true);
            ref.current?.focus();
          }}
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
      {hero && engine ? <span className="s-searchbox-engine">{engine}</span> : null}
      {hero ? (
        <button type="button" className="s-searchbox-submit" onClick={() => submit()} disabled={!value.trim()}>
          <span>搜索</span>
          <Icon name="arrowRight" size={15} />
        </button>
      ) : (
        <span className="s-searchbox-kbd">Ctrl K</span>
      )}

      {open ? (
        <div className="s-suggestions" role="listbox">
          {suggestions.map((text, index) => (
            <button
              key={`${text}-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`s-suggestion${index === activeIndex ? ' active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(text)}
            >
              <Icon name="search" size={13} />
              <span>{text}</span>
              <Icon name="arrowUpRight" size={12} className="s-suggestion-go" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
