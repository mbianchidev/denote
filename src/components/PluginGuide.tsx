import { Fragment, useMemo, type ReactNode } from "react";
import type { PhrasingContent, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

interface GuideSection {
  title: PhrasingContent[];
  blocks: RootContent[];
}

export function PluginMarkdown({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => fromMarkdown(markdown).children, [markdown]);
  return <div className="plugin-guide__content">{blocks.map((block, index) => renderBlock(block, `help-${index}`))}</div>;
}

export function PluginGuide({ guide }: { guide: string }) {
  const sections = useMemo(() => guideSections(guide), [guide]);

  return (
    <section className="plugin-guide">
      <h6>How to use</h6>
      {sections.map((section, sectionIndex) => (
        <div
          className="plugin-guide__section"
          key={`${plainText(section.title)}:${sectionIndex}`}
        >
          <strong className="plugin-guide__section-title">
            {renderInline(section.title, `section-${sectionIndex}`)}
          </strong>
          <div className="plugin-guide__content">
            {section.blocks.map((block, blockIndex) =>
              renderBlock(block, `section-${sectionIndex}-block-${blockIndex}`),
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function guideSections(guide: string): GuideSection[] {
  const root = fromMarkdown(guide);
  const sections: GuideSection[] = [];
  let current: GuideSection | null = null;

  for (const node of root.children) {
    if (node.type === "heading" && node.depth === 1) {
      continue;
    }
    if (node.type === "heading" && node.depth === 2) {
      current = { title: node.children, blocks: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { title: [{ type: "text", value: "Guide" }], blocks: [] };
      sections.push(current);
    }
    current.blocks.push(node);
  }

  return sections;
}

function renderBlock(node: RootContent, key: string): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p key={key}>{renderInline(node.children, key)}</p>;
    case "heading":
      return (
        <strong className="plugin-guide__subheading" key={key}>
          {renderInline(node.children, key)}
        </strong>
      );
    case "blockquote":
      return (
        <blockquote key={key}>
          {node.children.map((child, index) =>
            renderBlock(child, `${key}-quote-${index}`),
          )}
        </blockquote>
      );
    case "list": {
      const List = node.ordered ? "ol" : "ul";
      return (
        <List key={key} start={node.ordered ? node.start ?? undefined : undefined}>
          {node.children.map((item, itemIndex) => (
            <li key={`${key}-item-${itemIndex}`}>
              {item.children.map((child, childIndex) =>
                renderBlock(
                  child,
                  `${key}-item-${itemIndex}-block-${childIndex}`,
                ),
              )}
            </li>
          ))}
        </List>
      );
    }
    case "code":
      return (
        <pre key={key}>
          <code className={node.lang ? `language-${node.lang}` : undefined}>
            {node.value}
          </code>
        </pre>
      );
    case "thematicBreak":
      return <hr key={key} />;
    case "html":
      return (
        <pre key={key}>
          <code>{node.value}</code>
        </pre>
      );
    case "definition":
      return null;
    default:
      return null;
  }
}

function renderInline(
  nodes: PhrasingContent[],
  keyPrefix: string,
): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-inline-${index}`;
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "strong":
        return (
          <strong className="plugin-guide__emphasis" key={key}>
            {renderInline(node.children, key)}
          </strong>
        );
      case "emphasis":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "break":
        return <br key={key} />;
      case "link":
        return (
          <span className="plugin-guide__link" key={key} title={node.url}>
            {renderInline(node.children, key)}
            <span className="plugin-guide__link-url"> ({node.url})</span>
          </span>
        );
      case "linkReference":
        return (
          <span className="plugin-guide__link" key={key}>
            {renderInline(node.children, key)}
          </span>
        );
      case "image":
        return (
          <span key={key}>
            {node.alt?.trim() || "Image"}
          </span>
        );
      case "imageReference":
        return (
          <span key={key}>
            {node.alt?.trim() || "Image"}
          </span>
        );
      case "footnoteReference":
        return <sup key={key}>{node.label}</sup>;
      case "html":
        return <code key={key}>{node.value}</code>;
      default:
        return null;
    }
  });
}

function plainText(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
        case "inlineCode":
          return node.value;
        case "strong":
        case "emphasis":
        case "link":
        case "linkReference":
          return plainText(node.children);
        case "image":
        case "imageReference":
          return node.alt ?? "";
        case "footnoteReference":
          return node.label;
        default:
          return "";
      }
    })
    .join("");
}
