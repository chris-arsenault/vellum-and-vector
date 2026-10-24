import { useEffect, useRef, useState, type ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brand } from "./App";
import { externalHref, loreImage, lorePageForHref, lorePages, type LorePage } from "./loreContent";
import "./lore.css";

interface Props {
  onClose: () => void;
}

export function LoreEncyclopedia({ onClose }: Props) {
  const [pageId, setPageId] = useState(lorePages[0].id);
  const page = lorePages.find((entry) => entry.id === pageId) ?? lorePages[0];
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    article.current?.scrollTo({ top: 0 });
  }, [pageId]);
  return (
    <main className="lore">
      <header className="lore-header">
        <Brand />
        <h1>Encyclopedia</h1>
        <button className="quiet" onClick={onClose}>
          Return to atlas
        </button>
      </header>
      <div className="lore-body">
        <nav className="lore-nav" aria-label="Lore pages">
          {lorePages.map((entry) => (
            <button
              key={entry.id}
              className="quiet"
              aria-pressed={entry.id === page.id}
              onClick={() => setPageId(entry.id)}
            >
              {entry.title}
            </button>
          ))}
        </nav>
        <article className="lore-article" ref={article} aria-label={page.title}>
          <Markdown remarkPlugins={[remarkGfm]} components={components(page, setPageId)}>
            {page.markdown}
          </Markdown>
        </article>
      </div>
    </main>
  );
}

function components(page: LorePage, navigate: (id: string) => void): Components {
  return {
    img: ({ src, alt }: ComponentProps<"img">) => (
      <img src={loreImage(typeof src === "string" ? src : undefined)} alt={alt ?? ""} />
    ),
    a: ({ href, children }: ComponentProps<"a">) => {
      const target = href ? lorePageForHref(href) : undefined;
      if (target)
        return (
          <a
            href={`#${target.id}`}
            onClick={(event) => {
              event.preventDefault();
              navigate(target.id);
            }}
          >
            {children}
          </a>
        );
      return (
        <a href={href ? externalHref(href, page) : undefined} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
  };
}
