'use client';

/** Biztonságos snippet render — csak a ts_headline <mark> tageket engedjük. */
export function SearchSnippet({ html }: { html: string }) {
  const safe = html
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/gi, '<mark class="bg-amber-200 text-amber-950 rounded px-0.5">')
    .replace(/&lt;\/mark&gt;/gi, '</mark>');

  return (
    <span
      className="text-sm text-gray-700 line-clamp-2 [&_mark]:font-medium"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
