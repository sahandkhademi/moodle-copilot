import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md space-y-2 break-words text-[13.5px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 underline decoration-brand-500/40 underline-offset-2 hover:text-brand-700 dark:text-brand-500">
              {children}
            </a>
          ),
          p: ({ children }) => <p>{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          code: ({ children }) => <code className="rounded bg-slate-200/70 px-1 py-0.5 text-[12px] dark:bg-slate-700/70">{children}</code>,
          h1: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          h2: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          h3: ({ children }) => <h3 className="font-semibold">{children}</h3>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-slate-300 px-2 py-1 text-left font-semibold dark:border-slate-600">{children}</th>,
          td: ({ children }) => <td className="border-b border-slate-200 px-2 py-1 dark:border-slate-700">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
