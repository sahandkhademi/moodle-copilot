import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md space-y-2 break-words text-[0.9375rem] leading-normal">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:text-brand-700 hover:underline">
              {children}
            </a>
          ),
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          code: ({ children }) => <code className="bg-surface-3 px-1 py-0.5 text-[0.85em]">{children}</code>,
          h1: ({ children }) => <h3 className="font-bold">{children}</h3>,
          h2: ({ children }) => <h3 className="font-bold">{children}</h3>,
          h3: ({ children }) => <h3 className="font-bold">{children}</h3>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.8125rem]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-line px-2 py-1 text-left font-bold">{children}</th>,
          td: ({ children }) => <td className="border-b border-line px-2 py-1">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
