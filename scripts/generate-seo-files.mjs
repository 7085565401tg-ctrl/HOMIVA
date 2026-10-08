import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const output = resolve('dist');
const context = process.env.CONTEXT || '';
const isProduction = context === 'production';
const configuredUrl = isProduction ? process.env.URL : '';
const site = configuredUrl ? new URL(configuredUrl).origin : '';
const baseHtml = await readFile(resolve(output, 'index.html'), 'utf8');

function slugFor(title) {
  return String(title || 'home').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';
}

function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", '&apos;');
}

function listingHtml(listing, canonicalUrl) {
  const title = escapeHtml(listing.title + ' | HOMIVA');
  const place = [listing.locality, listing.city].filter(Boolean).join(', ');
  const plainDescription = String(listing.description || (listing.title + ' in ' + place + '. Explore the details on HOMIVA.'))
    .replace(/\s+/g, ' ').slice(0, 160);
  const description = escapeHtml(plainDescription);
  let html = baseHtml
    .replace(/<title>.*?<\/title>/s, '<title>' + title + '</title>')
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, '<meta name="description" content="' + description + '" />')
    .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, '<meta property="og:title" content="' + title + '" />')
    .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, '<meta property="og:description" content="' + description + '" />')
    .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, '<meta property="og:url" content="' + escapeHtml(canonicalUrl) + '" />');
  const canonicalTag = '<link rel="canonical" href="' + escapeHtml(canonicalUrl) + '" />';
  if (/<link rel="canonical"[^>]*\/>/.test(html)) {
    html = html.replace(/<link rel="canonical"[^>]*\/>/, canonicalTag);
  } else {
    html = html.replace('</head>', '    ' + canonicalTag + '\n  </head>');
  }
  return html;
}

if (context && !isProduction) {
  await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  await rm(resolve(output, 'sitemap.xml'), { force: true });
} else if (site) {
  await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /owner\nDisallow: /saved\nSitemap: ' + site + '/sitemap.xml\n');
  const homeHtml = baseHtml.replace(/<meta property="og:url" content="[^"]*"\s*\/>/, '<meta property="og:url" content="' + escapeHtml(site + '/') + '" />')
    .replace('</head>', '    <link rel="canonical" href="' + escapeHtml(site + '/') + '" />\n  </head>');
  await writeFile(resolve(output, 'index.html'), homeHtml);
  const sitemapEntries = new Map([[site + '/', '']]);
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseUrl && publishableKey) {
    const client = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const listings = [];
    let listingError = null;
    for (let offset = 0; offset < 5000; offset += 500) {
      const result = await client.from('listings')
        .select('id,title,description,city,locality,updated_at')
        .eq('status', 'published').order('updated_at', { ascending: false }).range(offset, offset + 499);
      if (result.error) { listingError = result.error; break; }
      listings.push(...(result.data || []));
      if ((result.data || []).length < 500) break;
    }
    if (listingError) {
      console.warn('Public listing SEO pages were skipped because the public listing query failed.');
    } else {
      for (const listing of listings) {
        if (!/^[0-9a-f-]{36}$/i.test(listing.id)) continue;
        const path = '/homes/' + encodeURIComponent(listing.id) + '/' + slugFor(listing.title);
        const url = site + path;
        const directory = resolve(output, 'homes', listing.id, slugFor(listing.title));
        await mkdir(directory, { recursive: true });
        await writeFile(resolve(directory, 'index.html'), listingHtml(listing, url));
        sitemapEntries.set(url, listing.updated_at || '');
      }
    }
  }
  const urls = [...sitemapEntries.entries()].map(([url, lastModified]) =>
    '  <url><loc>' + escapeXml(url) + '</loc>' + (lastModified ? '<lastmod>' + escapeXml(new Date(lastModified).toISOString()) + '</lastmod>' : '') + '</url>'
  ).join('\n');
  await writeFile(resolve(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n');
} else {
  await rm(resolve(output, 'sitemap.xml'), { force: true });
  await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
}
