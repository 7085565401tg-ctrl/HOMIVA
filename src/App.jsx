import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp, ArrowRight, Bath, BedDouble, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, Heart, Home, LayoutGrid,
  List, Mail, Map, MapPin, Menu, MessageCircle, MessageSquareText, Plus, Search,
  Send, ShieldCheck, SlidersHorizontal, Sofa, Sparkles, X, Upload, Wallet,
  Building2, Eye, UserRound, Share2, LocateFixed, LogIn, Camera, ArrowUpRight, Trash2
} from 'lucide-react';
import { api, discardListingUploads, jsonBody, subscribeToMessages } from './api.js';
import { supabase, supabaseConfigured } from './supabase.js';
import { estimatedMonthly, formatMoney, parseSearchIntent } from './data.js';

const MapCanvas = lazy(() => import('./MapCanvas.jsx'));
const MapCanvasLoading = () => <div className="leaflet-map" role="status" aria-label="Loading map" />;

const searchExamples = [
  '2 bedrooms in Pune under ₹20,000',
  'Furnished home with parking',
  'A room in Baner'
];
const amenityOptions = ['Parking', 'Balcony', 'Lift', 'Internet ready', 'Power backup', 'Outdoor space'];

function publicListingPath(home) {
  const slug = String(home.title || 'home').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';
  return '/homes/' + encodeURIComponent(home.id) + '/' + slug;
}

function currentListingId() {
  const pathMatch = window.location.pathname.match(/^\/homes\/([0-9a-f-]{36})(?:\/|$)/i);
  return new URLSearchParams(window.location.search).get('home') || pathMatch?.[1] || '';
}

function Brand({ onClick }) {
  return <button className="brand" onClick={onClick} aria-label="HOMIVA home"><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none"><path d="M5 15.5 16 6l11 9.5M9 14.5V26h14V14.5M14 26v-8h5v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span className="brand-word">HOMIVA<span>.</span></span></button>;
}

function Header({ screen, user, savedCount, navigate, signOut, signIn, openProfile }) {
  const [open, setOpen] = useState(false);
  const items = [['home', 'Explore'], ['saved', 'Saved homes'], ['owner', 'For owners']];
  return <header className="site-header"><div className="nav-inner">
    <Brand onClick={() => { navigate('home'); setOpen(false); }} />
    <nav className={'main-nav ' + (open ? 'main-nav-open' : '')} aria-label="Main navigation">
      {items.map(([id, label]) => <button key={id} className={'nav-link ' + ((screen === id || (id === 'home' && screen === 'results')) ? 'nav-active' : '')} onClick={() => { navigate(id); setOpen(false); }}>{label}{id === 'saved' && savedCount ? <span className="nav-count">{savedCount}</span> : null}</button>)}
      {user ? <><button className="nav-mobile-account" onClick={() => { openProfile(); setOpen(false); }}>Your profile</button><button className="nav-mobile-account" onClick={() => { signOut(); setOpen(false); }}>Sign out</button></> : <button className="nav-mobile-account" onClick={() => { signIn(); setOpen(false); }}>Sign in</button>}
    </nav>
    <div className="nav-actions">{user ? <div className="account-menu"><span className="account-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="account-name">{user.name}</span><button className="button button-quiet" onClick={openProfile}>Profile</button><button className="button button-quiet" onClick={signOut}>Sign out</button></div> : <><button className="button button-quiet signin-button" onClick={signIn}><LogIn size={15} /> Sign in</button><button className="button button-dark nav-list-button" onClick={() => navigate('owner')}><Plus size={16} /> List a home</button></>}</div>
    <button className="icon-button mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
  </div></header>;
}

function SearchBox({ value, onChange, onSubmit, compact = false }) {
  return <form className={'search-box ' + (compact ? 'search-box-compact' : '')} onSubmit={(event) => { event.preventDefault(); onSubmit(value); }}>
    <span className="search-box-icon"><Sparkles size={18} /></span><label className="sr-only" htmlFor={compact ? 'results-search' : 'home-search'}>Describe the home you need</label>
    <input id={compact ? 'results-search' : 'home-search'} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Tell us what you need — area, budget, must-haves..." />
    <button type="submit" className="search-submit">{compact ? <Search size={18} /> : <>Find a home <ArrowRight size={17} /></>}</button>
    {!compact ? <span className="search-hint">Search in your own words. We’ll only filter by details the listing confirms.</span> : null}
  </form>;
}

function HomePage({ searchText, setSearchText, runSearch, homes, navigate, openListing }) {
  return <main>
    <section className="hero-wrap"><div className="hero">
      <div className="hero-copy"><div className="eyebrow eyebrow-light"><span className="eyebrow-line" /> FIND WHERE LIFE FITS</div>
        <h1>A place that fits<br />your <em>real life.</em></h1>
        <p className="hero-intro">Search homes by what matters to you. See the full monthly cost, understand what’s known, and choose your next step with confidence.</p>
        <SearchBox value={searchText} onChange={setSearchText} onSubmit={runSearch} />
        <div className="hero-example"><span className="example-label">Try</span>{searchExamples.map((example) => <button key={example} className="example-chip" onClick={() => { setSearchText(example); runSearch(example); }}>{example}<ArrowRight size={12} /></button>)}</div>
      </div>
      <div className="hero-art-wrap" aria-label="HOMIVA housing illustration">
        <div className="hero-art-glow" />
        <svg className="hero-art" viewBox="0 0 560 500" role="img" aria-label="Illustration of homes in a quiet neighbourhood">
          <path d="M65 418h430" stroke="#a8b6a3" strokeWidth="2" strokeLinecap="round" />
          <path d="M96 422V206l112-72 112 72v216" fill="#f0eee4" stroke="#e5e9df" strokeWidth="3" strokeLinejoin="round" />
          <path d="m78 210 130-85 130 85" fill="none" stroke="#ced8bd" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M125 238h59v68h-59zM229 238h59v68h-59zM183 342h51v80h-51z" fill="#d1e1d3" />
          <path d="M355 422V245l73-53 72 53v177" fill="#dbe5d8" stroke="#cad6c5" strokeWidth="3" strokeLinejoin="round" />
          <path d="m338 250 90-67 90 67" fill="none" stroke="#a3b39b" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M383 278h37v47h-37zM446 278h37v47h-37zM411 355h38v67h-38z" fill="#f3f0e5" />
          <path d="M55 421c2-46 17-71 42-80 23 9 36 34 38 80M457 420c1-40 13-63 35-72 22 9 33 32 35 72" fill="#7e9a80" />
          <circle cx="96" cy="333" r="39" fill="#9db394" /><circle cx="495" cy="347" r="33" fill="#9db394" />
          <path d="M269 106c31-35 75-39 117-9" fill="none" stroke="#cfdfa6" strokeWidth="5" strokeLinecap="round" />
          <circle cx="365" cy="79" r="17" fill="#d3e6a1" />
          <g className="hero-art-birds" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="m428 119 9-7 9 7M455 133l7-5 7 5M384 112l7-5 7 5" /></g>
        </svg>
        <div className="hero-art-card"><span className="hero-art-card-icon"><ShieldCheck size={18} /></span><span><strong>Clearer choices</strong><small>Costs, details, next steps.</small></span><ArrowRight size={16} /></div>
        <span className="hero-art-caption">A calmer way to find home.</span>
      </div>
    </div>
    <div className="hero-bottom"><span><Check size={14} /> Search by your priorities</span><span><Check size={14} /> See known and estimated costs</span><span><Check size={14} /> Contact owners directly</span><button onClick={() => navigate('results')}>Explore homes <ArrowRight size={15} /></button></div>
    </section>
    <section className="section home-homes">
      <div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> HOMES TO EXPLORE</div><h2>Find your next place.</h2><p>Real listings, with the important details up front.</p></div><button className="text-button" onClick={() => navigate('results')}>Browse all homes <ArrowRight size={16} /></button></div>
      {homes.length ? <div className="home-card-grid">{homes.slice(0, 3).map((home) => <PropertyCard key={home.id} home={home} variant="grid" onOpen={openListing} />)}</div> : <div className="first-home-card"><div className="first-home-illustration"><Home size={27} /></div><div><span className="first-home-label">A NEW WAY TO FIND HOME</span><h3>The first listing starts with a real owner.</h3><p>No properties have been published yet. If you’re looking for a place, save a search and check back; if you have a home to rent, you can create its listing here.</p><div className="first-home-actions"><button className="button button-dark" onClick={() => navigate('owner')}><Plus size={16} /> List a home</button><button className="button button-outline" onClick={() => navigate('results')}>Explore search <ArrowRight size={15} /></button></div></div></div>}
      <div className="home-how"><div className="how-heading"><span className="how-icon"><Sparkles size={20} /></span><div><div className="eyebrow">A CLEARER WAY TO SEARCH</div><h3>Less scrolling. More certainty.</h3></div></div><div className="how-step"><span>01</span><strong>Tell us what matters</strong><p>Budget, space, area, or a simple sentence.</p></div><div className="how-step"><span>02</span><strong>Understand the trade-offs</strong><p>See rent, other known costs, and what’s still unknown.</p></div><div className="how-step"><span>03</span><strong>Take the next step</strong><p>Save a home, ask a question, or request a viewing.</p></div></div>
    </section>
  </main>;
}

function PropertyImage({ home, className = '' }) {
  return <div className={'property-image-wrap ' + className}>{home.image ? <img className="property-image" src={home.image} alt={'Photo for ' + home.title} loading="lazy" /> : <div className="no-photo"><Home size={27} /><span>Photos not added</span></div>}<span className="image-status"><span className="status-dot" /> Owner listed</span></div>;
}

function PropertyCard({ home, variant = 'row', saved, onSave, comparing, onCompare, onOpen }) {
  const monthly = estimatedMonthly(home);
  return <article className={'property-card property-card-' + variant}>
    <button className="property-image-button" onClick={() => onOpen(home)} aria-label={'View ' + home.title}><PropertyImage home={home} /></button>
    <div className="property-card-body"><div className="property-card-head"><div><div className="property-location"><MapPin size={13} />{home.locality}, {home.city}</div><button className="property-title" onClick={() => onOpen(home)}>{home.title}</button></div>
      {saved !== undefined ? <button className={'icon-button favorite-button ' + (saved ? 'favorite-active' : '')} onClick={() => onSave(home.id)} aria-label={saved ? 'Remove saved home' : 'Save home'} aria-pressed={saved}><Heart size={18} fill={saved ? 'currentColor' : 'none'} /></button> : null}
    </div>
    <div className="property-price-line"><strong>{formatMoney(home.price)}</strong><span>/ month</span><span className="property-type-inline">{home.type}</span></div>
    <div className="property-facts"><span><BedDouble size={15} />{home.bedrooms === 0 ? 'Studio' : home.bedrooms + (home.bedrooms === 1 ? ' bed' : ' beds')}</span><span><Bath size={15} />{home.bathrooms} bath</span><span><Building2 size={15} />{home.size ? home.size + ' sq ft' : 'Size not listed'}</span></div>
    <div className="property-tags">{(home.amenities || []).slice(0, 3).map((amenity) => <span key={amenity} className="property-tag">{amenity}</span>)}{home.furnishing && home.furnishing !== 'Unknown' ? <span className="property-tag">{home.furnishing}</span> : null}</div>
    <div className="property-cost-row"><span><Wallet size={15} /><span>Est. monthly cost <span className="tooltip-wrap"><button type="button" className="help-icon" aria-label="About estimated monthly cost"><CircleHelp size={13} /></button><span className="tooltip">Rent + maintenance + utilities, when all amounts have been provided.</span></span></span></span><strong>{monthly === null ? 'Ask owner' : formatMoney(monthly)}</strong></div>
    <div className="property-card-foot"><span className="unverified-note"><ShieldCheck size={14} /> Owner / home unverified</span><div className="property-actions">
      {onCompare ? <button className={'compare-mini ' + (comparing ? 'compare-mini-active' : '')} onClick={() => onCompare(home.id)}>{comparing ? <Check size={14} /> : <Plus size={14} />} Compare</button> : null}
      <button className="view-home-button" onClick={() => onOpen(home)}>View home <ArrowRight size={14} /></button>
    </div></div></div>
  </article>;
}

function SearchFilters({ filters, setFilters }) {
  const set = (key, value) => setFilters({ ...filters, [key]: value });
  return <div className="filter-bar"><div className="filter-label"><SlidersHorizontal size={16} /><span>Refine</span></div>
    <label className="filter-select-wrap"><span className="sr-only">Maximum monthly rent</span><select value={filters.maxBudget} onChange={(event) => set('maxBudget', event.target.value)}><option value="">Any budget</option><option value="10000">Under ₹10,000</option><option value="15000">Under ₹15,000</option><option value="20000">Under ₹20,000</option><option value="30000">Under ₹30,000</option></select><ChevronDown size={14} /></label>
    <label className="filter-select-wrap"><span className="sr-only">Bedrooms</span><select value={filters.bedrooms} onChange={(event) => set('bedrooms', event.target.value)}><option value="">Any bedrooms</option><option value="1">1 bedroom</option><option value="2">2 bedrooms</option><option value="3">3+ bedrooms</option></select><ChevronDown size={14} /></label>
    <label className="filter-select-wrap"><span className="sr-only">Bathrooms</span><select value={filters.bathrooms} onChange={(event) => set('bathrooms', event.target.value)}><option value="">Any bathrooms</option><option value="1">1+ bathroom</option><option value="2">2+ bathrooms</option><option value="3">3+ bathrooms</option></select><ChevronDown size={14} /></label>
    <label className="filter-select-wrap"><span className="sr-only">Furnishing</span><select value={filters.furnishing} onChange={(event) => set('furnishing', event.target.value)}><option value="">Any furnishing</option><option>Furnished</option><option>Semi-furnished</option><option>Unfurnished</option></select><ChevronDown size={14} /></label>
    <label className="filter-select-wrap"><span className="sr-only">Home type</span><select value={filters.type} onChange={(event) => set('type', event.target.value)}><option value="">Any home type</option><option>Apartment</option><option>House</option><option>Room</option><option>Studio</option></select><ChevronDown size={14} /></label>
    <label className="filter-select-wrap"><span className="sr-only">Home feature</span><select value={filters.amenity} onChange={(event) => set('amenity', event.target.value)}><option value="">Any feature</option>{amenityOptions.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>
    <label className="filter-select-wrap"><span className="sr-only">Availability</span><select value={filters.availability} onChange={(event) => set('availability', event.target.value)}><option value="">Any availability</option><option value="available">Available now</option><option value="upcoming">Available soon</option></select><ChevronDown size={14} /></label>
    <label className="filter-search-location"><MapPin size={14} /><span className="sr-only">Area</span><input value={filters.locality} onChange={(event) => set('locality', event.target.value)} placeholder="Area" /></label>
    <label className="parking-filter"><input type="checkbox" checked={filters.parking} onChange={(event) => set('parking', event.target.checked)} /><span className="custom-check">{filters.parking ? <Check size={12} /> : null}</span>Parking</label>
  </div>;
}

function IntentSummary({ intent, query, clear }) {
  const parts = [];
  if (intent.maxBudget) parts.push('Under ' + formatMoney(intent.maxBudget));
  if (intent.bedrooms) parts.push(intent.bedrooms + (intent.bedrooms === 1 ? ' bedroom' : ' bedrooms'));
  if (intent.furnishing) parts.push(intent.furnishing);
  if (intent.parking) parts.push('Parking');
  if (intent.place) parts.push(intent.place);
  if (intent.city) parts.push(intent.city);
  if (!parts.length) return null;
  return <div className="intent-summary"><span className="intent-spark"><Sparkles size={16} /></span><div className="intent-copy"><strong>Details recognized from your search</strong><span>These details are matched against information owners have added. Other preferences remain unconfirmed.</span></div><div className="intent-pills">{parts.map((part) => <span key={part}>{part}</span>)}</div><button className="intent-clear" onClick={clear} aria-label="Clear search details"><X size={16} /></button>{query ? <span className="sr-only">Search: {query}</span> : null}</div>;
}

function ResultsPage({ homes, searchText, setSearchText, runSearch, intent, clearIntent, filters, setFilters, saved, onSave, compare, onCompare, openListing, layout, setLayout, busy, hasMore, moreBusy, onMore }) {
  const [selectedId, setSelectedId] = useState('');
  const [sort, setSort] = useState('price-low');
  const sorted = useMemo(() => [...homes].sort((a, b) => sort === 'price-high' ? b.price - a.price : sort === 'cost-low' ? (estimatedMonthly(a) ?? Infinity) - (estimatedMonthly(b) ?? Infinity) : a.price - b.price), [homes, sort]);
  useEffect(() => { if (!sorted.some((home) => home.id === selectedId)) setSelectedId(sorted[0]?.id || ''); }, [sorted, selectedId]);
  const queryFor = (home) => openListing(home);
  return <main className="results-page"><div className="results-top">
    <div className="results-breadcrumb"><button onClick={() => runSearch('')}>Explore</button><ChevronRight size={14} /><span>Search homes</span></div>
    <div className="results-search-row"><div><div className="eyebrow"><span className="eyebrow-line" /> FIND YOUR PLACE</div><h1>Homes that fit your search.</h1></div><SearchBox value={searchText} onChange={setSearchText} onSubmit={runSearch} compact /></div>
    <IntentSummary intent={intent} query={searchText} clear={clearIntent} /><SearchFilters filters={filters} setFilters={setFilters} />
    <div className="results-meta-row"><div><strong>{busy ? '…' : homes.length}</strong> homes found <span className="results-meta-note">· Availability is set by each owner</span></div>
      <div className="results-view-actions"><label className="sort-wrap"><ArrowDownUp size={14} /><span className="sr-only">Sort homes</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="price-low">Rent: low to high</option><option value="price-high">Rent: high to low</option><option value="cost-low">Est. monthly: low to high</option></select><ChevronDown size={13} /></label>
        <div className="view-toggle" role="group" aria-label="Results layout"><button className={layout === 'list' ? 'view-active' : ''} onClick={() => setLayout('list')}><List size={15} />List</button><button className={layout === 'split' ? 'view-active' : ''} onClick={() => setLayout('split')}><LayoutGrid size={15} />Split</button><button className={layout === 'map' ? 'view-active' : ''} onClick={() => setLayout('map')}><Map size={15} />Map</button></div>
      </div>
    </div>
  </div>
  {busy ? <div className="loading-state"><span className="loader" />Finding homes that match…</div> : homes.length === 0 ? <EmptyResults onReset={() => { setFilters({ maxBudget: '', bedrooms: '', bathrooms: '', furnishing: '', type: '', amenity: '', availability: '', locality: '', city: '', parking: false }); clearIntent(); }} onList={() => runSearch('')} /> : layout === 'map' ? <div className="map-only-layout"><MapPanel homes={sorted} selectedId={selectedId} setSelectedId={setSelectedId} onOpen={queryFor} /><div className="map-results-strip">{sorted.map((home) => <button key={home.id} onClick={() => { setSelectedId(home.id); openListing(home); }}><span className="map-strip-img">{home.image ? <img src={home.image} alt="" /> : <Home size={19} />}</span><span><strong>{formatMoney(home.price)}<small>/mo</small></strong><span>{home.locality} · {home.bedrooms} bed</span></span><ArrowRight size={16} /></button>)}</div></div> : <div className={'results-content ' + (layout === 'split' ? 'results-split' : '')}><div className="property-results-list">{sorted.map((home) => <PropertyCard key={home.id} home={home} variant="row" saved={saved.includes(home.id)} onSave={onSave} comparing={compare.includes(home.id)} onCompare={onCompare} onOpen={openListing} />)}</div>{layout === 'split' ? <div className="results-map-sticky"><MapPanel homes={sorted} selectedId={selectedId} setSelectedId={setSelectedId} onOpen={queryFor} /></div> : null}</div>}
  {hasMore && !busy ? <div className="load-more"><button className="button button-outline" onClick={onMore} disabled={moreBusy}>{moreBusy ? 'Loading homes…' : 'Load more homes'} <ArrowRight size={15} /></button></div> : null}
  <div className="results-bottom-note"><ShieldCheck size={15} /><span>Check the owner’s information, availability, and total costs before making a decision.</span></div></main>;
}

function EmptyResults({ onReset, onList }) {
  return <div className="empty-state"><span className="empty-icon"><Search size={23} /></span><h2>No homes match those filters yet.</h2><p>Try a wider budget or area. You can also clear the details we picked up from your search and browse all current listings.</p><div className="empty-actions"><button className="button button-dark" onClick={onReset}>Clear filters <ArrowRight size={16} /></button><button className="button button-outline" onClick={onList}>Browse all homes</button></div><div className="empty-owner-note">Have a home to list? <button onClick={onList}>Owners can add the first listing <ArrowRight size={14} /></button></div></div>;
}

function MapPanel({ homes, selectedId, setSelectedId, onOpen }) {
  const mappable = homes.filter((home) => home.locationPin);
  const selected = homes.find((home) => home.id === selectedId);
  return <section className="map-panel"><div className="map-label"><span className="map-label-icon"><Map size={16} /></span><div><strong>Explore on the map</strong><span>Approximate locations · OpenStreetMap</span></div></div>
    <Suspense fallback={<MapCanvasLoading />}><MapCanvas homes={mappable} onSelect={(home) => { setSelectedId(home.id); }} /></Suspense>
    {selected ? <button className="map-selected-card" onClick={() => onOpen(selected)}>{selected.image ? <img src={selected.image} alt="" /> : <span className="map-popup-home"><Home size={19} /></span>}<span><strong>{selected.title}</strong><span>{selected.locality}, {selected.city} · {formatMoney(selected.price)}/mo</span></span><ArrowRight size={16} /></button> : null}
    {!mappable.length ? <div className="map-no-pins"><MapPin size={16} /><span>Homes without a location pin won’t appear on the map.</span></div> : null}
    <div className="map-footnote"><span><span className="map-legend-dot" /> Owner-selected approximate area</span><span>© OpenStreetMap contributors</span></div>
  </section>;
}

function SavedPage({ homes, onExplore, openListing, saved, onSave, compare, onCompare }) {
  return <main className="simple-page"><div className="page-eyebrow"><span className="eyebrow-line" /> YOUR SHORTLIST</div><div className="simple-heading-row"><div><h1>Homes you’ve saved.</h1><p>Your saved homes stay linked to your account.</p></div><span className="saved-count-badge"><Heart size={15} />{homes.length} saved</span></div>
    {homes.length ? <div className="property-results-list">{homes.map((home) => <PropertyCard key={home.id} home={home} variant="row" saved={saved.includes(home.id)} onSave={onSave} comparing={compare.includes(home.id)} onCompare={onCompare} onOpen={openListing} />)}</div> : <div className="empty-state empty-saved"><span className="empty-icon"><Heart size={23} /></span><h2>Your shortlist starts here.</h2><p>Save homes you want to come back to. We’ll keep them together while you compare.</p><button className="button button-dark" onClick={onExplore}>Explore homes <ArrowRight size={16} /></button></div>}
  </main>;
}

function OwnerPage({ user, homes, messages, viewings, createListing, openListing, openConversation, updateViewing, deleteListing, onReadMessages, signIn, signOut }) {
  const [tab, setTab] = useState('Overview');
  const tabs = ['Overview', 'Properties', 'Messages', 'Viewings'];
  if (!user) return <main className="owner-page"><div className="owner-intro"><div><div className="page-eyebrow"><span className="eyebrow-line" /> OWNER SPACE</div><h1>Give your home a clear first impression.</h1><p>Add the facts renters need, review your listing, and decide when it’s ready to publish.</p></div><button className="button button-dark" onClick={signIn}><LogIn size={16} /> Sign in or create account</button></div><section className="owner-join-card"><span className="owner-join-icon"><Building2 size={23} /></span><div><h2>Start with your real property details.</h2><p>HOMIVA helps you present rent, known costs, rooms, photos, and location in one clear listing. Your listing stays unpublished until you choose to publish it.</p></div><button className="button button-dark" onClick={signIn}>Get started <ArrowRight size={16} /></button></section><div className="owner-join-steps"><div><span>01</span><strong>Create your account</strong><p>Manage listings and respond to enquiries.</p></div><div><span>02</span><strong>Tell renters what’s known</strong><p>Add photos, costs, location and home details.</p></div><div><span>03</span><strong>Review, then publish</strong><p>Check the preview before your listing goes live.</p></div></div></main>;
  const ownerMessages = messages.filter((item) => item.direction === 'received');
  const ownerViewings = viewings.filter((item) => item.direction === 'received');
  const activeHomes = homes.filter((home) => home.status === 'published');
  const drafts = homes.filter((home) => home.status !== 'published');
  return <main className="owner-page"><div className="owner-intro"><div><div className="page-eyebrow"><span className="eyebrow-line" /> OWNER SPACE</div><h1>Welcome back, {user.name.split(' ')[0]}.</h1><p>Your homes, conversations, and viewing requests in one place.</p></div><div className="owner-intro-actions"><button className="button button-outline" onClick={signOut}>Sign out</button><button className="button button-dark" onClick={createListing}><Plus size={17} /> Add a home</button></div></div>
    <div className="owner-tabs" role="tablist">{tabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'owner-tab-active' : ''} onClick={() => { setTab(item); if (item === 'Messages') onReadMessages(); }}>{item}{item === 'Messages' && ownerMessages.some((message) => message.unread) ? <span>{ownerMessages.filter((message) => message.unread).length}</span> : null}{item === 'Viewings' && ownerViewings.filter((viewing) => viewing.status === 'Requested').length ? <span>{ownerViewings.filter((viewing) => viewing.status === 'Requested').length}</span> : null}</button>)}</div>
    {tab === 'Overview' ? <><div className="owner-stats"><div><span>Published homes</span><strong>{activeHomes.length}</strong><small>Visible to renters</small></div><div><span>Drafts</span><strong>{drafts.length}</strong><small>Only you can see drafts</small></div><div><span>New messages</span><strong>{ownerMessages.length}</strong><small>Listing enquiries</small></div><div><span>Viewings requested</span><strong>{ownerViewings.length}</strong><small>Awaiting your response</small></div></div>
      <section className="owner-panel"><div className="owner-panel-heading"><div><h2>Your homes</h2><p>Manage your published listings and drafts.</p></div><button className="text-button" onClick={() => setTab('Properties')}>See all <ArrowRight size={15} /></button></div>{homes.length ? <div className="owner-property-list">{homes.slice(0, 4).map((home) => <OwnerPropertyRow key={home.id} home={home} openListing={openListing} onDelete={deleteListing} />)}</div> : <OwnerEmptyCopy title="Your owner space is ready" text="Add a property when you’re ready. It stays a draft until you publish it." action={createListing} />}</section>
      <section className="owner-next-panel"><div className="owner-next-icon"><ShieldCheck size={20} /></div><div><strong>Clear details build better decisions.</strong><p>Only publish information you can confirm. HOMIVA doesn’t verify owner identity or property documents yet.</p></div><button className="text-button" onClick={() => setTab('Properties')}>Manage homes <ArrowRight size={15} /></button></section>
    </> : tab === 'Properties' ? <section className="owner-panel owner-tab-panel"><div className="owner-panel-heading"><div><h2>Your listings</h2><p>Manage the details and publication state of each home.</p></div><button className="button button-dark button-small" onClick={createListing}><Plus size={15} /> New listing</button></div>{homes.length ? <div className="owner-property-list">{homes.map((home) => <OwnerPropertyRow key={home.id} home={home} openListing={openListing} onDelete={deleteListing} />)}</div> : <OwnerEmptyCopy title="No homes added yet" text="Create a listing to see its preview here." action={createListing} />}</section>
      : tab === 'Messages' ? <section className="owner-panel owner-tab-panel"><div className="owner-panel-heading"><div><h2>Messages</h2><p>Private conversations with people interested in your listings.</p></div></div>{ownerMessages.length ? <div className="owner-inbox">{ownerMessages.map((item) => <div className="inbox-message" key={item.conversationId}><div className="inbox-avatar">{(item.name || 'R').slice(0, 1).toUpperCase()}</div><div className="inbox-main"><div className="inbox-head"><strong>{item.name}</strong><span>{new Date(item.createdAt).toLocaleDateString('en-IN')}</span></div><span className="inbox-property">{item.propertyTitle}</span><p>{item.message}</p><span className="inbox-contact"><Mail size={13} />{item.email}</span>{item.unread ? <span className="inbox-unread">New message</span> : null}<button className="text-button inbox-reply" onClick={() => openConversation(item)}>Open conversation <ArrowRight size={14} /></button></div></div>)}</div> : <OwnerEmptyCopy title="No messages yet" text="Enquiries and replies about your listings appear here." />}</section>
        : <section className="owner-panel owner-tab-panel"><div className="owner-panel-heading"><div><h2>Viewing requests</h2><p>Your outgoing requests and owner replies stay in one place.</p></div></div>{viewings.length ? <div className="viewing-list">{viewings.map((item) => <div className="viewing-row" key={item.id}><div className="viewing-date"><CalendarDays size={17} /><span>{new Date(item.date + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></div><div className="viewing-info"><strong>{item.direction === 'sent' ? 'You · ' + item.propertyTitle : item.name + ' · ' + item.propertyTitle}</strong><span>{item.time}{item.note ? ' · ' + item.note : ''}</span></div><span className={'viewing-status viewing-status-' + item.status.toLowerCase()}>{item.status}</span>{item.status === 'Requested' && item.direction === 'received' ? <div className="viewing-actions"><button onClick={() => updateViewing(item.id, 'Accepted')}>Accept</button><button onClick={() => updateViewing(item.id, 'Declined')}>Decline</button></div> : null}{item.status === 'Requested' && item.direction === 'sent' ? <div className="viewing-actions"><button onClick={() => updateViewing(item.id, 'Cancelled')}>Cancel request</button></div> : null}</div>)}</div> : <OwnerEmptyCopy title="No viewing requests" text="Requests you send or receive will appear here." />}</section>}
  </main>;
}

function OwnerPropertyRow({ home, openListing, onDelete }) {
  return <div className="owner-property-row"><span className="owner-row-photo">{home.image ? <img src={home.image} alt="" /> : <Home size={20} />}</span><div className="owner-property-info"><strong>{home.title}</strong><span>{home.locality}, {home.city} · {formatMoney(home.price)}/mo</span></div><span className={home.status === 'published' ? 'published-pill' : 'draft-pill'}>{home.status === 'published' ? 'Published' : 'Draft'}</span><button className="icon-button" onClick={() => openListing(home)} aria-label="Preview listing"><Eye size={17} /></button><button className="icon-button owner-delete-button" onClick={() => onDelete(home)} aria-label={'Delete ' + home.title}><Trash2 size={16} /></button></div>;
}

function OwnerEmptyCopy({ title, text, action }) {
  return <div className="owner-empty owner-empty-centered"><span className="empty-icon"><MessageSquareText size={21} /></span><div><strong>{title}</strong><span>{text}</span></div>{action ? <button className="button button-outline" onClick={action}><Plus size={15} /> Add a home</button> : null}</div>;
}

function PropertyDetail({ home, user, saved, comparing, onClose, onSave, onCompare, onMessage, onViewing, onShare, ownerToggle, onEdit }) {
  const total = estimatedMonthly(home);
  return <div className="modal-backdrop detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="detail-modal" role="dialog" aria-modal="true" aria-label={'Details for ' + home.title}>
    <div className="detail-topbar"><span><span className="status-dot" />{home.status === 'published' ? 'OWNER LISTED' : 'YOUR DRAFT'} <span className="detail-dot-sep">·</span> OWNER / HOME UNVERIFIED</span><button className="icon-button" onClick={onClose} aria-label="Close property details"><X size={20} /></button></div>
    {home.images?.length > 1 ? <div className="detail-gallery">{home.images.slice(0, 5).map((image, index) => <img key={image.path} src={image.url} alt={image.alt || home.title + ' · photo ' + (index + 1)} loading="lazy" />)}</div> : home.image ? <div className="detail-photo"><img src={home.image} alt={home.title} /></div> : <div className="detail-photo detail-photo-empty"><Home size={35} /><span>Owner hasn’t added a photo</span></div>}
    <div className="detail-content"><div className="detail-main">
      <div className="property-location"><MapPin size={14} />{home.locality}, {home.city}<span className="detail-dot-sep">·</span>{home.type}</div><h2>{home.title}</h2><div className="detail-price"><strong>{formatMoney(home.price)}</strong><span>/ month</span><span className="detail-deposit">Deposit {formatMoney(home.deposit)}</span></div>
      <div className="detail-quick-facts"><IconPill icon={BedDouble}>{home.bedrooms === 0 ? 'Studio' : home.bedrooms + ' bedrooms'}</IconPill><IconPill icon={Bath}>{home.bathrooms} bathrooms</IconPill><IconPill icon={Building2}>{home.size ? home.size + ' sq ft' : 'Size not listed'}</IconPill><IconPill icon={Sofa}>{home.furnishing || 'Furnishing unknown'}</IconPill></div>
      <div className="detail-section"><div className="detail-section-title"><h3>About this home</h3></div><p>{home.description || 'The owner hasn’t added a description yet.'}</p><div className="detail-amenities">{(home.amenities || []).map((item) => <span key={item}><Check size={14} />{item}</span>)}</div></div>
      <div className="detail-section"><div className="detail-section-title"><h3>Availability and rules</h3><Clock3 size={17} /></div><p>{home.availability || 'Confirm availability with the owner.'}{home.availableFrom ? ' · Available from ' + new Date(home.availableFrom + 'T12:00:00').toLocaleDateString() : ''}</p>{home.rules ? <p>{home.rules}</p> : <p>Ask the owner to confirm any house rules before arranging a visit.</p>}</div>
      <div className="detail-section cost-section"><div className="detail-section-title"><h3>Understand the monthly cost</h3><Wallet size={17} /></div><div className="cost-breakdown"><CostRow label="Rent" value={home.price} state="Owner listed" /><CostRow label="Maintenance" value={home.maintenance} state={home.maintenance === null ? 'Not provided' : 'Owner listed'} /><CostRow label="Utilities" value={home.utilities} state={home.utilities === null ? 'Not provided' : 'Owner estimate'} /><div className="cost-total"><span>Estimated monthly total <em>{total === null ? 'Incomplete · some costs are unknown' : 'Rent + maintenance + owner utility estimate'}</em></span><strong>{total === null ? 'Unavailable' : formatMoney(total)}</strong></div></div><p className="cost-note"><CircleHelp size={14} />Confirm recurring costs with the owner. Utility bills may vary.</p></div>
      <div className="detail-section trust-section"><div className="detail-section-title"><h3>Owner and listing details</h3><ShieldCheck size={17} /></div><div className="trust-status"><span className="trust-status-icon"><ShieldCheck size={18} /></span><div><strong>Not independently verified</strong><span>HOMIVA hasn’t verified this owner’s identity or property documents.</span></div></div><div className="trust-owner"><span className="trust-avatar"><UserRound size={18} /></span><div><strong>{home.owner || 'Property owner'}</strong><span>Owner provided listing <i>·</i> Details last updated {new Date(home.updatedAt || home.createdAt).toLocaleDateString('en-IN')}</span></div></div></div>
      {home.locationPin ? <div className="detail-section location-section"><div className="detail-section-title"><h3>{home.isOwner ? 'Your private location' : 'Approximate location'}</h3><span><MapPin size={14} />{home.isOwner ? 'Owner view' : 'Area only'}</span></div><div className="detail-mini-map"><Suspense fallback={<MapCanvasLoading />}><MapCanvas homes={[home]} /></Suspense><p>{home.isOwner ? 'This exact pin is private to your account. Public listing pages use only a rounded area pin.' : 'The map pin is approximate. The owner’s exact address is private. Confirm nearby places and travel times directly.'}</p></div></div> : <div className="detail-section location-section"><div className="detail-section-title"><h3>Location</h3><span><MapPin size={14} />{home.locality}, {home.city}</span></div><p className="detail-location-missing">The owner hasn’t added a map pin. Ask them about the exact area and nearby places.</p></div>}
      {home.status === 'published' ? <div className="detail-safety-note"><ShieldCheck size={17} /><span>Confirm the property, all costs, availability, and who you’re speaking with before paying a deposit.</span><button onClick={onMessage}>Ask a question</button></div> : null}
    </div><aside className="detail-actions-card"><div className="detail-action-price"><strong>{formatMoney(home.price)}</strong><span>/ month</span></div><div className="detail-action-location"><MapPin size={14} />{home.locality}, {home.city}</div>
      {home.status === 'published' && !home.isOwner ? <><button className="button button-dark button-full" onClick={onViewing}><CalendarDays size={17} /> Request a viewing</button><button className="button button-outline button-full" onClick={onMessage}><MessageCircle size={17} /> Contact owner</button><div className="detail-secondary-actions"><button className={saved ? 'is-saved' : ''} onClick={() => onSave(home.id)}><Heart size={16} fill={saved ? 'currentColor' : 'none'} />{saved ? 'Saved' : 'Save'}</button><button className={comparing ? 'is-saved' : ''} onClick={() => onCompare(home.id)}><Plus size={16} />{comparing ? 'Comparing' : 'Compare'}</button><button onClick={onShare}><Share2 size={16} />Share</button></div></> : home.isOwner ? <><div className="owner-own-notice">This listing belongs to your account.</div>{home.status === 'draft' ? <button className="button button-outline button-full" onClick={() => ownerToggle(home)}>Publish listing <ArrowRight size={15} /></button> : null}{home.status === 'draft' ? <button className="button button-quiet button-full" onClick={() => onEdit(home)}>Edit listing</button> : <button className="button button-outline button-full" onClick={() => ownerToggle(home)}>Unpublish listing <ArrowRight size={15} /></button>}</> : <button className="button button-dark button-full" onClick={onMessage}><MessageCircle size={17} /> Contact owner</button>}
      <div className="availability-note"><Clock3 size={15} /><span><strong>{home.availability || 'Availability to confirm'}</strong><small>Check with the owner before arranging a visit.</small></span></div><div className="detail-action-demo"><span className="status-dot" />Owner submitted · HOMIVA hasn’t verified</div>
    </aside></div>
  </section></div>;
}

function IconPill({ children, icon: Icon }) { return <span className="icon-pill"><Icon size={14} />{children}</span>; }
function CostRow({ label, value, state }) { return <div><span>{label} <em>{state}</em></span><strong>{formatMoney(value)}</strong></div>; }

function Modal({ title, subtitle, onClose, children, wide = false, className = '' }) {
  useEffect(() => { const onKey = (event) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={'dialog-modal ' + (wide ? 'dialog-modal-wide ' : '') + className} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-heading"><div><h2 id="dialog-title">{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>{children}</section></div>;
}

function AuthDialog({ initial = 'login', onClose, onSuccess }) {
  const [mode, setMode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      if (mode === 'forgot') {
        await api('/api/auth/password-reset', { method: 'POST', body: jsonBody({ email: form.get('email') }) });
        setNotice('If an account uses this email, a password reset link is on its way.');
        return;
      }
      if (mode === 'recovery') {
        const password = String(form.get('password') || '');
        if (password !== String(form.get('confirmPassword') || '')) throw new Error('The passwords do not match.');
        const result = await api('/api/auth/update-password', { method: 'POST', body: jsonBody({ password }) });
        setNotice('Your password was updated.');
        onSuccess(result.user);
        return;
      }
      const result = await api(mode === 'register' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: jsonBody({ name: form.get('name'), email: form.get('email'), password: form.get('password') }) });
      if (result.needsConfirmation) {
        setNotice('Check your email for a confirmation link. You can sign in after confirming your address.');
        return;
      }
      onSuccess(result.user);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const title = mode === 'register' ? 'Create your HOMIVA account' : mode === 'forgot' ? 'Reset your password' : mode === 'recovery' ? 'Choose a new password' : 'Welcome back';
  const subtitle = mode === 'register' ? 'One account for your search and your listings.' : mode === 'forgot' ? 'We’ll send a secure reset link if the account exists.' : mode === 'recovery' ? 'Use a new password you have not used elsewhere.' : 'Sign in to your HOMIVA account.';
  return <Modal title={title} subtitle={subtitle} onClose={onClose}>
    <form className="dialog-form" onSubmit={submit}>{mode === 'register' ? <label>Your name<input name="name" autoComplete="name" placeholder="Full name" required minLength="2" maxLength="80" /></label> : null}
      {mode !== 'recovery' ? <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength="180" /></label> : null}
      {mode !== 'forgot' ? <label>{mode === 'recovery' ? 'New password' : 'Password'}<input name="password" type="password" autoComplete={mode === 'register' || mode === 'recovery' ? 'new-password' : 'current-password'} placeholder={mode === 'register' || mode === 'recovery' ? 'At least 10 characters' : 'Your password'} required minLength={mode === 'register' || mode === 'recovery' ? 10 : 1} maxLength="200" /></label> : null}
      {mode === 'recovery' ? <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength="10" maxLength="200" /></label> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}{notice ? <div className="form-success" role="status">{notice}</div> : null}
      <button className="button button-dark button-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'recovery' ? 'Update password' : 'Sign in'} <ArrowRight size={16} /></button>
      {mode === 'login' ? <p className="auth-switch"><button type="button" onClick={() => { setError(''); setNotice(''); setMode('forgot'); }}>Forgot your password?</button></p> : null}
      {mode !== 'recovery' ? <p className="auth-switch">{mode === 'register' ? 'Already have an account?' : mode === 'forgot' ? 'Remembered your password?' : 'New to HOMIVA?'} <button type="button" onClick={() => { setError(''); setNotice(''); setMode(mode === 'register' || mode === 'forgot' ? 'login' : 'register'); }}>{mode === 'register' || mode === 'forgot' ? 'Sign in' : 'Create an account'}</button></p> : null}
      <p className="auth-privacy">Account security and password storage are handled by Supabase Auth.</p>
    </form>
  </Modal>;
}

function ProfileDialog({ user, onClose, onSave }) {
  const [name, setName] = useState(user.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave(name); onClose(); }
    catch (failure) { setError(failure.message || 'Your profile could not be updated.'); }
    finally { setBusy(false); }
  };
  return <Modal title="Your HOMIVA profile" subtitle="Manage the name shown to owners and in your account." onClose={onClose}>
    <form className="dialog-form" onSubmit={submit}>
      <label>Display name<input name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength="2" maxLength="80" /></label>
      <label>Email address<input type="email" value={user.email} readOnly disabled /></label>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="button button-dark button-full" disabled={busy}>{busy ? 'Saving…' : 'Save profile'} <ArrowRight size={16} /></button>
    </form>
  </Modal>;
}

function MessageDialog({ home, onClose, onSubmit, conversation, messages, loading }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  useEffect(() => {
    setText(conversation ? '' : 'Hi, I’m interested in ' + home.title + '. Is it available, and could you share more about the total monthly costs?');
    setError('');
  }, [home.id, conversation?.id]);
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await onSubmit(text); setText(''); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  return <Modal title={conversation ? 'Your conversation' : 'Ask the owner'} subtitle={home.title + ' · ' + home.locality} onClose={onClose}>
    {conversation ? <div className="message-thread" aria-live="polite">{loading ? <div className="thread-loading">Loading conversation…</div> : messages.length ? messages.map((item) => <div className={'thread-message ' + (item.direction === 'sent' ? 'thread-message-sent' : '')} key={item.id}><span>{item.direction === 'sent' ? 'You' : item.name || 'Owner'} · {new Date(item.createdAt).toLocaleString()}</span><p>{item.message}</p></div>) : <p className="thread-loading">Start your conversation with the owner.</p>}</div> : null}
    <form className="dialog-form" onSubmit={submit}><label>{conversation ? 'Your reply' : 'Your message'}<textarea name="message" rows="4" value={text} onChange={(event) => setText(event.target.value)} required minLength="4" maxLength="1200" /></label>{error ? <div className="form-error" role="alert">{error}</div> : null}{!conversation ? <div className="form-local-note"><CircleHelp size={15} /><span>Your name and email from your HOMIVA account will be shared with this listing owner.</span></div> : null}<button className="button button-dark button-full" disabled={busy || loading}><Send size={16} />{busy ? 'Sending…' : conversation ? 'Send reply' : 'Start conversation'}</button></form>
  </Modal>;
}

function ViewingDialog({ home, onClose, onSubmit }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = new Date();
  const minDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try { await onSubmit({ date: form.get('date'), time: form.get('time'), note: form.get('note') }); onClose(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  return <Modal title="Request a viewing" subtitle={home.title + ' · ' + home.locality} onClose={onClose}><form className="dialog-form" onSubmit={submit}>
    <div className="form-two-col"><label>Preferred date<input type="date" name="date" min={minDate} required /></label><label>Time<select name="time" defaultValue="" required><option value="" disabled>Choose a time</option><option>Morning · 9 am–12 pm</option><option>Afternoon · 12–4 pm</option><option>Evening · 4–7 pm</option></select></label></div>
    <label>Note <span className="field-optional">optional</span><textarea name="note" rows="2" placeholder="Anything the owner should know?" maxLength="300" /></label>
    {error ? <div className="form-error">{error}</div> : null}<div className="form-local-note"><CircleHelp size={15} /><span>The owner will review your request and respond through HOMIVA.</span></div><button className="button button-dark button-full" disabled={busy}><CalendarDays size={16} />{busy ? 'Sending…' : 'Send viewing request'}</button>
  </form></Modal>;
}

function NewListingDialog({ onClose, onCreated, initial = null }) {
  const [form, setForm] = useState(() => initial ? {
    title: initial.title || '', type: initial.type || 'Apartment', locality: initial.locality || '', city: initial.city || '', address: initial.address || '',
    price: String(initial.price ?? ''), deposit: String(initial.deposit ?? ''), maintenance: String(initial.maintenance ?? ''),
    utilities: String(initial.utilities ?? ''), bedrooms: String(initial.bedrooms ?? 1), bathrooms: String(initial.bathrooms ?? 1),
    size: String(initial.size ?? ''), furnishing: initial.furnishing || 'Unknown', amenities: initial.amenities || [], description: initial.description || '',
    availabilityStatus: initial.availabilityStatus || 'available', availableFrom: initial.availableFrom || '', rules: initial.rules || '', contactPreference: initial.contactPreference || 'platform'
  } : { title: '', type: 'Apartment', locality: '', city: '', address: '', price: '', deposit: '', maintenance: '', utilities: '', bedrooms: '1', bathrooms: '1', size: '', furnishing: 'Unfurnished', amenities: [], description: '', availabilityStatus: 'available', availableFrom: '', rules: '', contactPreference: 'platform' });
  const [photos, setPhotos] = useState(() => initial?.images?.length ? initial.images : initial?.image ? [{ path: initial.imagePath, url: initial.image, alt: initial.title }] : []);
  const [pin, setPin] = useState(initial?.locationPin || null);
  const [showMap, setShowMap] = useState(false);
  const [locateRequest, setLocateRequest] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });
  const choosePhotos = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setError('');
    try {
      const next = [];
      for (const file of files.slice(0, Math.max(0, 10 - photos.length))) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose JPG, PNG, or WebP photos.');
        if (file.size > 8 * 1024 * 1024) throw new Error('Choose photos under 8 MB each.');
        const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        const optimized = await new Promise((resolve, reject) => {
          const photo = new Image();
          photo.onload = () => {
            if (!photo.width || !photo.height || photo.width > 12000 || photo.height > 12000 || photo.width * photo.height > 25_000_000) {
              reject(new Error('Choose a photo with smaller dimensions.')); return;
            }
            const scale = Math.min(1, 1440 / photo.width, 1000 / photo.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(photo.width * scale)); canvas.height = Math.max(1, Math.round(photo.height * scale));
            const context = canvas.getContext('2d');
            if (!context) { reject(new Error('This photo could not be prepared.')); return; }
            context.drawImage(photo, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/webp', 0.76));
          };
          photo.onerror = reject; photo.src = source;
        });
        if (optimized.length > 1_450_000) throw new Error('Choose a smaller or simpler image.');
        next.push({ dataUrl: optimized, preview: optimized, name: file.name });
      }
      setPhotos((previous) => [...previous, ...next]);
      if (files.length > next.length) setError('A listing can have up to 10 photos.');
    } catch (failure) { setError(failure.message || 'We couldn’t prepare that photo. Try another.'); }
  };
  const createDraft = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    const uploadedPaths = [];
    try {
      const images = [];
      for (const photo of photos) {
        if (photo.dataUrl) {
          const uploaded = await api('/api/uploads', { method: 'POST', body: jsonBody({ image: photo.dataUrl }) });
          uploadedPaths.push(uploaded.path);
          images.push({ path: uploaded.path, alt: form.title });
        }
        else if (photo.path) images.push({ path: photo.path, alt: photo.alt || form.title });
      }
      const details = { ...form, price: form.price, latitude: pin?.latitude ?? null, longitude: pin?.longitude ?? null, images };
      const result = initial
        ? await api('/api/properties/' + encodeURIComponent(initial.id), { method: 'PATCH', body: jsonBody(details) })
        : await api('/api/properties', { method: 'POST', body: jsonBody(details) });
      onCreated(result.property);
    } catch (failure) {
      try { await discardListingUploads(uploadedPaths); } catch {}
      setError(failure.message);
    } finally { setBusy(false); }
  };
  return <Modal title={initial ? 'Edit your home listing' : 'Create a home listing'} subtitle="Add the real details someone would need to make a decision." onClose={onClose} wide>
    <form className="listing-form" onSubmit={createDraft}>
      <div className="listing-progress"><span className="progress-current" /><span /><span /></div>
      <label>Listing title<input name="title" value={form.title} onChange={update} placeholder="e.g. Bright 2 bedroom near Baner road" required minLength="5" maxLength="100" /></label>
      <div className="form-two-col"><label>Property type<select name="type" value={form.type} onChange={update}><option>Apartment</option><option>House</option><option>Room</option><option>Studio</option></select></label><label>Area / locality<input name="locality" value={form.locality} onChange={update} placeholder="e.g. Aundh" required minLength="2" maxLength="70" /></label></div>
      <div className="form-two-col"><label>City<input name="city" value={form.city} onChange={update} placeholder="e.g. Pune" required minLength="2" maxLength="70" /></label><label>Monthly rent (₹)<input name="price" type="number" min="1" max="100000000" value={form.price} onChange={update} placeholder="15000" required /></label></div>
      <label>Exact address <span className="field-optional">optional · private to your account</span><input name="address" value={form.address} onChange={update} placeholder="Street and building (never shown publicly)" maxLength="160" /></label>
      <div className="form-three-col"><label>Deposit (₹) <span className="field-optional">if known</span><input name="deposit" type="number" min="0" value={form.deposit} onChange={update} placeholder="Not required" /></label><label>Maintenance (₹) <span className="field-optional">if known</span><input name="maintenance" type="number" min="0" value={form.maintenance} onChange={update} placeholder="Not required" /></label><label>Utilities (₹) <span className="field-optional">monthly estimate</span><input name="utilities" type="number" min="0" value={form.utilities} onChange={update} placeholder="Not required" /></label></div>
      <div className="form-three-col"><label>Bedrooms<select name="bedrooms" value={form.bedrooms} onChange={update}><option value="0">Studio</option><option value="1">1 bedroom</option><option value="2">2 bedrooms</option><option value="3">3 bedrooms</option><option value="4">4 bedrooms</option><option value="5">5+ bedrooms</option></select></label><label>Bathrooms<select name="bathrooms" value={form.bathrooms} onChange={update}><option value="1">1 bathroom</option><option value="2">2 bathrooms</option><option value="3">3 bathrooms</option><option value="4">4+ bathrooms</option></select></label><label>Size (sq ft) <span className="field-optional">optional</span><input name="size" type="number" min="1" value={form.size} onChange={update} placeholder="850" /></label></div>
      <label>Furnishing<select name="furnishing" value={form.furnishing} onChange={update}><option>Unfurnished</option><option>Semi-furnished</option><option>Furnished</option><option>Unknown</option></select></label>
      <fieldset className="amenity-field"><legend>Home features <span className="field-optional">choose only what’s included</span></legend><div className="amenity-options">{amenityOptions.map((item) => <label key={item} className={form.amenities.includes(item) ? 'amenity-option amenity-option-selected' : 'amenity-option'}><input type="checkbox" checked={form.amenities.includes(item)} onChange={() => setForm({ ...form, amenities: form.amenities.includes(item) ? form.amenities.filter((value) => value !== item) : [...form.amenities, item] })} />{form.amenities.includes(item) ? <Check size={13} /> : <Plus size={13} />}{item}</label>)}</div></fieldset>
      <label>About this home <span className="field-optional">only include details you can confirm</span><textarea name="description" value={form.description} onChange={update} rows="3" placeholder="Share practical details that help someone picture daily life here." maxLength="1200" /></label>
      <label>Photos <span className="field-optional">up to 10 photos · optional</span><span className="upload-box upload-gallery">{photos.length ? <span className="upload-gallery-grid">{photos.map((photo, index) => <span className="upload-photo" key={photo.path || photo.name || index}><img src={photo.preview || photo.url} alt={photo.alt || 'Listing photo preview'} /><span className="upload-success"><CheckCircle2 size={14} />{index === 0 ? 'Cover photo' : 'Photo ' + (index + 1)}</span><button type="button" className="upload-remove" onClick={() => setPhotos((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} aria-label={'Remove photo ' + (index + 1)}><X size={15} /></button></span>)}{photos.length < 10 ? <span className="upload-add-photo"><Camera size={18} /><strong>Add photos</strong><span>JPG, PNG, WebP · up to 8 MB each</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => { choosePhotos(event.target.files); event.target.value = ''; }} /></span> : null}</span> : <><Camera size={18} /><strong>Choose photos</strong><span>JPG, PNG, WebP · up to 8 MB each · 10 max</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => { choosePhotos(event.target.files); event.target.value = ''; }} /></>}</span></label>
      <div className="form-two-col"><label>Availability<select name="availabilityStatus" value={form.availabilityStatus} onChange={update}><option value="available">Available now</option><option value="upcoming">Available soon</option><option value="unavailable">Not currently available</option></select></label>{form.availabilityStatus === 'upcoming' ? <label>Available from<input name="availableFrom" type="date" value={form.availableFrom} onChange={update} /></label> : null}</div>
      <label>House rules <span className="field-optional">optional · only what you can confirm</span><textarea name="rules" value={form.rules} onChange={update} rows="2" maxLength="1200" placeholder="Share any practical rules renters should know." /></label>
      <label>Contact preference<select name="contactPreference" value={form.contactPreference} onChange={update}><option value="platform">Message through HOMIVA</option><option value="viewing">Viewing requests preferred</option><option value="either">Either is fine</option></select></label>
      <div className="location-picker-heading"><div><strong>Approximate map location</strong><span>The public map uses an area pin; your exact address stays private.</span></div><button type="button" className="button button-outline button-small" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide map' : pin ? 'Adjust pin' : 'Choose location'} <MapPin size={14} /></button></div>
      {showMap ? <div className="location-map-picker"><div className="location-map-actions"><span>Click the map to place a pin, or drag the marker.</span><button type="button" onClick={() => setLocateRequest((value) => value + 1)}><LocateFixed size={14} /> Use my location</button></div><Suspense fallback={<MapCanvasLoading />}><MapCanvas value={pin} onChange={setPin} locateRequest={locateRequest} /></Suspense></div> : null}
      {pin ? <div className="location-pin-set"><CheckCircle2 size={15} />Map pin set. Public view shows an approximate area only.</div> : <div className="location-pin-set location-pin-unset"><CircleHelp size={15} />A map pin is optional; the area and city will still appear.</div>}
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-local-note"><CircleHelp size={15} /><span>Your listing starts as a private draft. Review it and press Publish only when it’s ready.</span></div>
      <div className="dialog-form-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-dark" disabled={busy}>{busy ? 'Saving draft…' : initial ? 'Review changes' : 'Review listing'} <ArrowRight size={16} /></button></div>
    </form>
  </Modal>;
}

function PublishDialog({ home, onClose, onPublish, onEdit, busy, error }) {
  return <Modal title="Review your listing" subtitle="This is how renters will see your home." onClose={onClose} wide className="publish-modal">
    <div className="listing-preview-banner"><Eye size={16} /> PRIVATE DRAFT · ONLY YOU CAN SEE THIS</div>
    <div className="listing-preview-card">{home.image ? <img src={home.image} alt={home.title} /> : <div className="preview-no-photo"><Home size={28} /><span>No photo added</span></div>}<div className="listing-preview-body"><div className="property-location"><MapPin size={13} />{home.locality}, {home.city} · {home.type}</div><h3>{home.title}</h3><strong>{formatMoney(home.price)}<small>/ month</small></strong><div className="listing-preview-facts">{home.bedrooms === 0 ? 'Studio' : home.bedrooms + ' bedroom'} · {home.bathrooms} bathroom{home.size ? ' · ' + home.size + ' sq ft' : ''} · {home.furnishing}</div><p>{home.description || 'No description provided yet.'}</p><div className="property-tags">{(home.amenities || []).map((item) => <span key={item} className="property-tag">{item}</span>)}</div></div></div>
    <div className="listing-preview-unknown"><ShieldCheck size={17} /><span><strong>Owner and property are unverified.</strong> Verify availability, all costs, and listing details before renters make decisions.</span></div>
    {error ? <div className="form-error">{error}</div> : null}<div className="dialog-form-actions"><button className="button button-outline" onClick={onEdit}>Edit details</button><button className="button button-dark" onClick={onPublish} disabled={busy}>{busy ? 'Publishing…' : 'Publish listing'} <ArrowRight size={16} /></button></div>
  </Modal>;
}

function ComparePanel({ homes, remove, close, openListing }) {
  const rows = [['Monthly rent', (home) => formatMoney(home.price)], ['Deposit', (home) => formatMoney(home.deposit)], ['Maintenance', (home) => formatMoney(home.maintenance)], ['Est. monthly total', (home) => estimatedMonthly(home) === null ? 'Incomplete' : formatMoney(estimatedMonthly(home))], ['Bedrooms', (home) => home.bedrooms], ['Bathrooms', (home) => home.bathrooms], ['Size', (home) => home.size ? home.size + ' sq ft' : 'Not listed'], ['Furnishing', (home) => home.furnishing], ['Area', (home) => home.locality + ', ' + home.city], ['Type', (home) => home.type], ['Trust', () => 'Not verified'], ['Availability', (home) => home.availability || 'Confirm with owner']];
  return <div className="compare-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="compare-modal" role="dialog" aria-modal="true" aria-label="Compare homes"><div className="compare-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR SHORTLIST</div><h2>Compare the details.</h2><p>Use owner-provided values to weigh your options. Unknowns stay visible.</p></div><button className="icon-button" onClick={close} aria-label="Close comparison"><X size={20} /></button></div>
    <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>Details</th>{homes.map((home) => <th key={home.id}><div className="compare-property-head">{home.image ? <img src={home.image} alt="" /> : <span className="compare-no-photo"><Home size={16} /></span>}<span><strong>{home.title}</strong><small>{home.locality}, {home.city}</small></span><button onClick={() => remove(home.id)} aria-label={'Remove ' + home.title}><X size={14} /></button></div><button className="compare-open" onClick={() => openListing(home)}>View home <ArrowRight size={14} /></button></th>)}</tr></thead><tbody>{rows.map(([label, valueFor], index) => <tr key={label} className={index === 3 ? 'compare-cost-row' : ''}><th>{label}</th>{homes.map((home) => <td key={home.id}>{valueFor(home)}</td>)}</tr>)}</tbody></table></div><div className="compare-footnote"><CircleHelp size={15} /> Ask the owner to confirm costs marked as incomplete or estimated.</div>
  </section></div>;
}

function CompareDock({ homes, remove, open }) {
  if (!homes.length) return null;
  return <div className="compare-dock"><div className="compare-dock-homes">{homes.map((home) => <span key={home.id}>{home.image ? <img src={home.image} alt="" /> : <span className="dock-no-photo"><Home size={12} /></span>}<strong>{home.locality}</strong><button onClick={() => remove(home.id)} aria-label={'Remove ' + home.locality}><X size={13} /></button></span>)}</div><div className="compare-dock-copy"><strong>Compare homes</strong><span>{homes.length} of 3 selected</span></div><button className="button button-dark" onClick={open} disabled={homes.length < 2}>{homes.length < 2 ? 'Add one more' : 'Compare now'} <ArrowRight size={15} /></button></div>;
}

function Footer({ navigate }) {
  return <footer className="site-footer"><div className="footer-top"><Brand onClick={() => navigate('home')} /><p>Find where life fits.</p><button onClick={() => navigate('owner')}>Have a place to share? <span>List it with HOMIVA <ArrowRight size={14} /></span></button></div><div className="footer-bottom"><span>© {new Date().getFullYear()} HOMIVA</span><span>Clearer housing decisions start here.</span><a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Back to top ↑</a></div></footer>;
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return <div className="toast-message" role="status"><span><CheckCircle2 size={17} />{message}</span><button onClick={onClose} aria-label="Dismiss notification"><X size={15} /></button></div>;
}

export default function App() {
  const [screen, setScreen] = useState('home');
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [listings, setListings] = useState([]);
  const [listingBusy, setListingBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const activeQuery = useRef('');
  const [allSaved, setAllSaved] = useState([]);
  const [savedProperties, setSavedProperties] = useState([]);
  const [ownerHomes, setOwnerHomes] = useState([]);
  const [messages, setMessages] = useState([]);
  const [viewings, setViewings] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [intent, setIntent] = useState(parseSearchIntent(''));
  const [filters, setFilters] = useState({ city: '', locality: '', maxBudget: '', bedrooms: '', bathrooms: '', furnishing: '', type: '', amenity: '', availability: '', parking: false });
  const [layout, setLayout] = useState('list');
  const [compare, setCompare] = useState([]);
  const [detail, setDetail] = useState(null);
  const [dialog, setDialog] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [afterAuth, setAfterAuth] = useState(null);
  const [draft, setDraft] = useState(null);
  const [listingInitial, setListingInitial] = useState(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [actionHome, setActionHome] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [conversationBusy, setConversationBusy] = useState(false);
  const [replyConversationId, setReplyConversationId] = useState('');
  const [toast, setToast] = useState('');
  const [ownerReady, setOwnerReady] = useState(false);

  const loadPublic = useCallback(async (params = '', offset = 0, append = false) => {
    if (append) setMoreBusy(true);
    else setListingBusy(true);
    try {
      const result = await api('/api/properties?limit=24&offset=' + offset + params);
      setListings((previous) => append ? [...previous, ...(result.properties || [])] : (result.properties || []));
      setHasMore(Boolean(result.hasMore));
      setNextOffset(Number(result.nextOffset) || 0);
    } catch (error) {
      setToast(error.message);
    } finally {
      if (append) setMoreBusy(false);
      else setListingBusy(false);
    }
  }, []);
  const loadPrivate = useCallback(async () => {
    if (!user) return;
    try {
      const [savedResult, ownerResult, messageResult, viewingResult] = await Promise.all([
        api('/api/me/saved'), api('/api/me/properties'), api('/api/me/messages'), api('/api/me/viewings')
      ]);
      setSavedProperties(savedResult.properties || []);
      setAllSaved((savedResult.properties || []).map((home) => home.id));
      setOwnerHomes(ownerResult.properties || []);
      setMessages(messageResult.messages || []);
      setViewings(viewingResult.viewings || []);
    } catch (error) {
      if (!error.message.includes('sign in')) setToast(error.message);
    }
  }, [user]);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoadingUser(false);
      setToast('Connect this app to Supabase to enable accounts, listings, and saved data.');
      loadPublic();
      return undefined;
    }
    let active = true;
    const checkSession = () => window.setTimeout(async () => {
      try {
        const result = await api('/api/me');
        if (active) setUser(result.user);
      } catch {}
      finally { if (active) setLoadingUser(false); }
    }, 0);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') { setAuthMode('recovery'); setDialog('auth'); }
      checkSession();
    });
    const query = new URLSearchParams(window.location.search);
    if (query.has('resetPassword')) { setAuthMode('recovery'); setDialog('auth'); }
    checkSession();
    loadPublic();
    return () => { active = false; subscription.unsubscribe(); };
  }, [loadPublic]);
  useEffect(() => { if (user) loadPrivate(); else { setSavedProperties([]); setAllSaved([]); setOwnerHomes([]); setMessages([]); setViewings([]); } }, [user, loadPrivate]);
  useEffect(() => { if (screen === 'owner' && user && ownerReady) loadPrivate(); }, [screen, user, ownerReady, loadPrivate]);
  useEffect(() => {
    if (dialog !== 'message' || !user || !actionHome) return undefined;
    let active = true;
    setConversationBusy(true); setConversation(null); setConversationMessages([]);
    const path = replyConversationId
      ? '/api/conversations/' + encodeURIComponent(replyConversationId)
      : '/api/conversations?listingId=' + encodeURIComponent(actionHome.id);
    api(path).then((result) => {
      if (!active) return;
      setConversation(result.conversation || null);
      setConversationMessages(result.messages || []);
    }).catch((error) => { if (active) setToast(error.message); })
      .finally(() => { if (active) setConversationBusy(false); });
    return () => { active = false; };
  }, [dialog, user, actionHome, replyConversationId]);
  useEffect(() => {
    if (!user) return undefined;
    return subscribeToMessages(user.id, () => {
      loadPrivate();
      if (dialog === 'message' && replyConversationId) {
        api('/api/conversations/' + encodeURIComponent(replyConversationId)).then((result) => {
          setConversationMessages(result.messages || []);
        }).catch(() => {});
      }
    });
  }, [user, loadPrivate, dialog, replyConversationId]);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(''), 3700); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const privateView = screen === 'owner' || screen === 'saved' || dialog === 'auth';
    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.appendChild(robots); }
    robots.content = privateView ? 'noindex,nofollow' : 'index,follow';
  }, [screen, dialog]);
  useEffect(() => {
    const title = detail?.status === 'published' ? detail.title + ' | HOMIVA' : 'HOMIVA — Find where life fits';
    const description = detail?.status === 'published'
      ? (detail.description || detail.title + ' in ' + detail.locality + ', ' + detail.city + '. Explore the details on HOMIVA.').slice(0, 160)
      : 'Search homes by what actually matters to you. Find where life fits with HOMIVA.';
    document.title = title;
    const setMeta = (selector, content) => {
      let element = document.querySelector(selector);
      if (!element) { element = document.createElement('meta'); document.head.appendChild(element); }
      element.content = content;
    };
    setMeta('meta[name="description"]', description);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[property="og:url"]', window.location.origin + (detail?.status === 'published' ? publicListingPath(detail) : '/'));
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.appendChild(canonical); }
    canonical.href = window.location.origin + (detail?.status === 'published' ? publicListingPath(detail) : '/');
  }, [detail]);
  useEffect(() => {
    const id = currentListingId();
    if (!id) return;
    api('/api/properties/' + encodeURIComponent(id)).then((result) => setDetail(result.property)).catch(() => setToast('This home is no longer available.'));
  }, []);
  useEffect(() => {
    const onPop = () => {
      const id = currentListingId();
      if (!id) { setDetail(null); return; }
      api('/api/properties/' + encodeURIComponent(id)).then((result) => setDetail(result.property)).catch(() => setDetail(null));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (screen !== 'results') return;
    const query = new URLSearchParams();
    const manual = filters.maxBudget ? Number(filters.maxBudget) : null;
    const inferredBudget = intent.maxBudget ? Number(intent.maxBudget) : null;
    const maximum = manual || inferredBudget;
    if (maximum) query.set('maxBudget', String(maximum));
    const bedrooms = filters.bedrooms || intent.bedrooms;
    if (bedrooms) query.set('bedrooms', String(bedrooms));
    if (filters.bathrooms) query.set('bathrooms', String(filters.bathrooms));
    const furnishing = filters.furnishing || intent.furnishing;
    if (furnishing) query.set('furnishing', furnishing);
    if (filters.type) query.set('type', filters.type);
    if (filters.amenity) query.set('amenity', filters.amenity);
    if (filters.availability) query.set('availability', filters.availability);
    const locality = filters.locality || intent.place;
    if (locality) query.set('locality', locality);
    const city = filters.city || intent.city;
    if (city) query.set('city', city);
    if (filters.parking || intent.parking) query.set('parking', 'true');
    const suffix = query.toString() ? '&' + query.toString() : '';
    activeQuery.current = suffix;
    loadPublic(suffix);
  }, [screen, filters, intent, loadPublic]);

  const navigate = (next) => {
    if ((next === 'owner' || next === 'saved') && !user && !loadingUser) { setAfterAuth({ type: 'navigate', screen: next }); setAuthMode('login'); setDialog('auth'); return; }
    setScreen(next); setDetail(null); setDialog(''); setOwnerReady(next === 'owner');
    if (next === 'results') { setSearchText(''); setIntent(parseSearchIntent('')); setFilters({ city: '', locality: '', maxBudget: '', bedrooms: '', bathrooms: '', furnishing: '', type: '', amenity: '', availability: '', parking: false }); }
    if (currentListingId()) window.history.pushState({}, '', '/');
  };
  const runSearch = (value) => {
    const query = String(value || '');
    const parsed = parseSearchIntent(query);
    setSearchText(query); setIntent(parsed);
    setFilters((previous) => ({ ...previous, city: '', locality: '', maxBudget: '', bedrooms: '', bathrooms: '', furnishing: '', type: '', amenity: '', availability: '', parking: false }));
    setScreen('results'); setLayout('list');
  };
  const clearIntent = () => { setSearchText(''); setIntent(parseSearchIntent('')); };
  const openListing = async (home) => {
    if (home.status === 'published') {
      try { const result = await api('/api/properties/' + encodeURIComponent(home.id)); setDetail(result.property); }
      catch (error) { setToast(error.message); return; }
    } else setDetail(home);
    const url = home.status === 'published' ? publicListingPath(home) : '/?home=' + encodeURIComponent(home.id);
    window.history.pushState({ home: home.id }, '', url);
  };
  const closeDetail = () => { setDetail(null); if (currentListingId()) window.history.pushState({}, '', '/'); };
  const needAuth = (action) => { setAfterAuth(action); setAuthMode('login'); setDialog('auth'); };
  const createListing = () => { setListingInitial(null); setDialog('listing'); };
  const authSuccess = async (nextUser) => {
    setUser(nextUser); setDialog(''); setToast('You’re signed in.');
    const next = afterAuth; setAfterAuth(null);
    if (next?.type === 'owner') { setScreen('owner'); setOwnerReady(true); }
    if (next?.type === 'navigate') { setScreen(next.screen); setOwnerReady(next.screen === 'owner'); }
    if (next?.type === 'listing') setDialog('listing');
    if (next?.type === 'message') { setReplyConversationId(''); setDialog('message'); }
    if (next?.type === 'viewing') setDialog('viewing');
    if (next?.type === 'save') await toggleSaved(next.id, true, nextUser);
  };
  const signIn = (mode = 'login') => { setAuthMode(mode); setAfterAuth(null); setDialog('auth'); };
  const signOut = async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: jsonBody({}) }); }
    catch (error) { setToast(error.message || 'You could not be signed out. Please try again.'); return; }
    setUser(null); setScreen('home'); setDialog(''); setReplyConversationId(''); setConversation(null); setConversationMessages([]); setToast('You’re signed out.');
  };
  const toggleSaved = async (id, force = false, signedUser = user) => {
    if (!signedUser) { needAuth({ type: 'save', id }); return; }
    const saved = allSaved.includes(id);
    try {
      const result = await api('/api/me/saved/' + encodeURIComponent(id), { method: 'PUT', body: jsonBody({ saved: force || !saved }) });
      setAllSaved(result.saved || []);
      await loadPrivate();
      setToast(force || !saved ? 'Added to your saved homes.' : 'Removed from your saved homes.');
    } catch (error) { setToast(error.message); }
  };
  const toggleCompare = (id) => setCompare((previous) => {
    if (previous.includes(id)) return previous.filter((value) => value !== id);
    if (previous.length >= 3) { setToast('You can compare up to 3 homes at a time.'); return previous; }
    return [...previous, id];
  });
  const loadMore = () => loadPublic(activeQuery.current, nextOffset, true);
  const compareHomes = compare.map((id) => listings.find((home) => home.id === id) || savedProperties.find((home) => home.id === id) || ownerHomes.find((home) => home.id === id)).filter(Boolean);
  const beginMessage = (home, conversationId = '') => {
    setActionHome(home);
    setReplyConversationId(conversationId);
    setConversation(null); setConversationMessages([]);
    if (!user) needAuth({ type: 'message' });
    else setDialog('message');
  };
  const openConversation = async (item) => {
    try {
      const result = await api('/api/conversations/' + encodeURIComponent(item.conversationId));
      beginMessage({ id: item.propertyId, title: result.conversation.listingTitle || item.propertyTitle, locality: '', status: 'published' }, item.conversationId);
    } catch (error) { setToast(error.message); }
  };
  const beginViewing = (home) => {
    setActionHome(home);
    if (!user) needAuth({ type: 'viewing' });
    else setDialog('viewing');
  };
  const submitMessage = async (message) => {
    const currentConversation = replyConversationId || conversation?.id;
    const result = await api(currentConversation ? '/api/conversations/' + encodeURIComponent(currentConversation) + '/messages' : '/api/messages', { method: 'POST', body: jsonBody({ propertyId: actionHome.id, message }) });
    if (result.message?.conversationId) setReplyConversationId(result.message.conversationId);
    await loadPrivate();
    if (result.message?.conversationId) {
      const thread = await api('/api/conversations/' + encodeURIComponent(result.message.conversationId));
      setConversation(thread.conversation); setConversationMessages(thread.messages || []);
    }
    setToast(currentConversation ? 'Your message was sent.' : 'Your conversation started with the owner.');
  };
  const submitViewing = async (values) => {
    await api('/api/viewings', { method: 'POST', body: jsonBody({ propertyId: actionHome.id, ...values }) });
    await loadPrivate(); setToast('Viewing request sent to the property owner.');
  };
  const listingCreated = (property) => {
    setListingInitial(null); setOwnerHomes((previous) => [property, ...previous.filter((home) => home.id !== property.id)]);
    if (property.status === 'published') {
      setDialog(''); setToast('Your listing changes are live.'); loadPublic(); return;
    }
    setDraft(property);
    setDialog('publish'); setPublishError('');
  };
  const publishListing = async () => {
    setPublishBusy(true); setPublishError('');
    try {
      const result = await api('/api/properties/' + encodeURIComponent(draft.id), { method: 'PATCH', body: jsonBody({ status: 'published' }) });
      setOwnerHomes((previous) => previous.map((home) => home.id === draft.id ? result.property : home));
      setDraft(null); setDialog(''); setScreen('owner'); setOwnerReady(true);
      setToast('Your listing is now published.');
      await loadPublic();
    } catch (error) { setPublishError(error.message); } finally { setPublishBusy(false); }
  };
  const togglePublished = async (home) => {
    const status = home.status === 'published' ? 'draft' : 'published';
    try {
      const result = await api('/api/properties/' + encodeURIComponent(home.id), { method: 'PATCH', body: jsonBody({ status }) });
      setOwnerHomes((previous) => previous.map((item) => item.id === home.id ? result.property : item));
      setDetail(result.property); setToast(status === 'published' ? 'Listing published.' : 'Listing unpublished.');
      await loadPublic();
    } catch (error) { setToast(error.message); }
  };
  const updateViewing = async (id, status) => {
    try { await api('/api/viewings/' + encodeURIComponent(id), { method: 'PATCH', body: jsonBody({ status }) }); await loadPrivate(); setToast('Viewing request ' + status.toLowerCase() + '.'); }
    catch (error) { setToast(error.message); }
  };
  const deleteListing = async (home) => {
    if (!window.confirm('Delete “' + home.title + '”? Listings with message or viewing history must be unpublished instead.')) return;
    try {
      await api('/api/properties/' + encodeURIComponent(home.id), { method: 'DELETE' });
      setOwnerHomes((previous) => previous.filter((item) => item.id !== home.id));
      if (detail?.id === home.id) closeDetail();
      setToast('Listing deleted.'); await loadPublic();
    } catch (error) { setToast(error.message); }
  };
  const markMessagesRead = async () => {
    try { await api('/api/me/messages/read', { method: 'POST', body: jsonBody({}) }); await loadPrivate(); }
    catch (error) { setToast(error.message); }
  };
  const saveProfile = async (name) => {
    const result = await api('/api/me/profile', { method: 'PATCH', body: jsonBody({ name }) });
    setUser(result.user); setToast('Your profile was updated.');
  };
  const shareHome = async () => {
    const url = window.location.origin + publicListingPath(detail);
    try { await navigator.clipboard.writeText(url); setToast('Property link copied.'); } catch { window.prompt('Copy this property link', url); }
  };

  const screenHomes = listings;
  return <div className="app-shell" id="top">
    <Header screen={screen} user={user} savedCount={allSaved.length} navigate={navigate} signOut={signOut} signIn={() => signIn('login')} openProfile={() => setDialog('profile')} />
    {screen === 'home' ? <HomePage searchText={searchText} setSearchText={setSearchText} runSearch={runSearch} homes={screenHomes} navigate={navigate} openListing={openListing} />
      : screen === 'results' ? <ResultsPage homes={screenHomes} searchText={searchText} setSearchText={setSearchText} runSearch={runSearch} intent={intent} clearIntent={clearIntent} filters={filters} setFilters={setFilters} saved={allSaved} onSave={toggleSaved} compare={compare} onCompare={toggleCompare} openListing={openListing} layout={layout} setLayout={setLayout} busy={listingBusy} hasMore={hasMore} moreBusy={moreBusy} onMore={loadMore} />
        : screen === 'saved' ? <SavedPage homes={savedProperties} onExplore={() => navigate('results')} openListing={openListing} saved={allSaved} onSave={toggleSaved} compare={compare} onCompare={toggleCompare} />
          : <OwnerPage user={user} homes={ownerHomes} messages={messages} viewings={viewings} createListing={() => user ? createListing() : needAuth({ type: 'listing' })} openListing={openListing} openConversation={openConversation} updateViewing={updateViewing} deleteListing={deleteListing} onReadMessages={markMessagesRead} signIn={() => signIn('register')} signOut={signOut} />}
    <Footer navigate={navigate} />
    {detail ? <PropertyDetail home={detail} user={user} saved={allSaved.includes(detail.id)} comparing={compare.includes(detail.id)} onClose={closeDetail} onSave={toggleSaved} onCompare={toggleCompare} onMessage={() => beginMessage(detail)} onViewing={() => beginViewing(detail)} onShare={shareHome} ownerToggle={togglePublished} onEdit={(home) => { setListingInitial(home); setDetail(null); window.history.pushState({}, '', '/'); setDialog('listing'); }} /> : null}
    {dialog === 'auth' ? <AuthDialog initial={authMode} onClose={() => setDialog('')} onSuccess={authSuccess} /> : null}
    {dialog === 'profile' && user ? <ProfileDialog user={user} onClose={() => setDialog('')} onSave={saveProfile} /> : null}
    {dialog === 'message' && actionHome ? <MessageDialog home={actionHome} onClose={() => { setDialog(''); setReplyConversationId(''); }} onSubmit={submitMessage} conversation={conversation} messages={conversationMessages} loading={conversationBusy} /> : null}
    {dialog === 'viewing' && actionHome ? <ViewingDialog home={actionHome} onClose={() => setDialog('')} onSubmit={submitViewing} /> : null}
    {dialog === 'listing' ? <NewListingDialog initial={listingInitial} onClose={() => { setDialog(''); setListingInitial(null); }} onCreated={listingCreated} /> : null}
    {dialog === 'publish' && draft ? <PublishDialog home={draft} onClose={() => { setDialog(''); setDraft(null); }} onPublish={publishListing} onEdit={() => { setListingInitial(draft); setDialog('listing'); }} busy={publishBusy} error={publishError} /> : null}
    {dialog === 'compare' ? <ComparePanel homes={compareHomes} remove={(id) => setCompare((previous) => previous.filter((value) => value !== id))} close={() => setDialog('')} openListing={(home) => { setDialog(''); openListing(home); }} /> : null}
    <CompareDock homes={compareHomes} remove={(id) => setCompare((previous) => previous.filter((value) => value !== id))} open={() => { if (compareHomes.length >= 2) setDialog('compare'); }} />
    {loadingUser ? <span className="account-loading" aria-live="polite">Loading account…</span> : null}
    <Toast message={toast} onClose={() => setToast('')} />
  </div>;
}
