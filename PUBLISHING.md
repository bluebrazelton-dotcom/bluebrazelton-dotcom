# Publishing a blog post

Cadence: a new essay every other Tuesday, morning. Best day for this audience.
Everything lives flat at the repo root — post pages included.

## Steps
1. Copy `_post-template.html` → `your-slug.html`.
   Slug: lowercase, hyphenated, no date (e.g. `boxes-and-boxes.html`).
2. Fill the `{{...}}` fields:
   - `{{TITLE}}` — appears twice (in <title> and <h1>)
   - `{{SLUG}}` — in the canonical link; must match the filename
   - `{{ONE_SENTENCE_DESCRIPTION}}` — the <meta description>
   - `{{MONTH DD, YYYY}}` — the dateline (the Tuesday it goes live)
   - One `<p>…</p>` per body paragraph
   - Optional `<blockquote class="pullquote">` for one featured line
   - References: paste each cite in its own `<p class="muted small sans">`;
     wrap any bare URL or DOI as `<a href="URL">URL</a>`
3. Add the post to `writing.html`: paste a new `<li>` at the TOP of
   `<ul class="entry-list">` (newest first):
```html
   <li>
     <div class="entry-meta">Mon DD, YYYY</div>
     <div class="entry-body">
       <p class="entry-body__title"><a href="your-slug.html">Title</a></p>
       <p class="entry-body__note">One-line teaser.</p>
     </div>
   </li>
```
4. Commit + push. Cloudflare Pages auto-builds.
5. ~1–2 weeks later: cross-post the full piece to Substack with the
   canonical URL set to the bluebrazelton.com page. Then a short LinkedIn
   post linking to the site.

## Notes
- All links are flat: just `filename.html`, no folders, no `../`.
- Only the body, title, date, slug, description, and refs change between posts.
  Head/nav/footer are identical everywhere — don't edit them per-post.
- Keep `aria-current="page"` on the Writing nav link in post pages.
- The `?v=6` on styles.css is a cache-buster; bump it sitewide only if you
  change styles.css.
