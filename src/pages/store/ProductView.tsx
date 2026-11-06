import { useState } from 'react'
import { ArrowLeft, BadgeCheck, Check, Droplets, Minus, Play, Plus, ShieldCheck, ShoppingCart, Truck, Wrench } from 'lucide-react'
import { Status } from '../../components/ui'
import { complianceFacts, productPath } from '../../lib/seo'
import { ACL_GUARANTEE, STORE_POLICY } from '../../lib/storePolicy'
import { STOCK_LABEL, type Product, type UserAccount } from '../../lib/types'
import { cx, money } from '../../lib/utils'
import { addOn, cheapestChoice, choicePhoto, choiceText, Price, ProductImage, ProductVideo, STOCK_TONE, useMostlyVisible, varies, type Choice } from './shopping'

/** Photos and clips made by AI (stored under photos/ai/ or videos/ai/), rather than taken of the product. */
const isRender = (src: string) => /\/(photos|videos)\/ai\//.test(src)

/** WELS stars, WaterMark and safety glass, as short badges (on product cards and pages). */
export function ComplianceBadges({ p, small }: { p: Product; small?: boolean }) {
  const c = p.compliance ?? {}
  const badges: { icon: typeof Droplets; text: string; title: string }[] = []
  if (c.welsStars) badges.push({ icon: Droplets, text: `WELS ${c.welsStars} star${c.welsWater && !small ? ` · ${c.welsWater}` : ''}`, title: 'Water Efficiency Labelling and Standards rating' })
  // Only a recorded licence number counts as proof: a standard alone isn't certification.
  if (c.watermark) badges.push({ icon: BadgeCheck, text: 'WaterMark', title: 'Certified for plumbing installation in Australia' })
  if ((c.standards ?? []).some((s) => /2208/.test(s))) badges.push({ icon: ShieldCheck, text: 'AS/NZS 2208 safety glass', title: 'Australian safety glazing standard' })
  if (!badges.length) return null
  return (
    <ul className={cx('flex flex-wrap gap-1.5', small ? 'text-[11px]' : 'text-xs')} aria-label="Compliance">
      {badges.map(({ icon: Icon, text, title }) => (
        <li key={text} title={title} className="inline-flex items-center gap-1 border border-slate-200 bg-white px-1.5 py-0.5 font-semibold text-slate-700">
          <Icon size={small ? 12 : 14} className="text-accent-ink" aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  )
}

/** A product card in the catalogue. */
export function ProductCard({ p, user, onOpen, onAdd, routed }: { p: Product; user: UserAccount | null; onOpen: () => void; onAdd: () => void; routed: boolean }) {
  const hasOptions = (p.options ?? []).length > 0
  const video = p.videos?.[0]
  const second = p.images[1]
  // Clips play while the pointer is over the card or, on touch screens (no hover), while it's mostly on screen.
  const [hover, setHover] = useState(false)
  const [mediaRef, visible] = useMostlyVisible<HTMLButtonElement>()
  const canHover = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches
  const playing = !!video && (canHover ? hover : visible)
  return (
    <article
      className="group card flex flex-col overflow-hidden transition-shadow hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <button ref={mediaRef} className="relative block overflow-hidden bg-white text-left" onClick={onOpen} aria-label={`View ${p.title}`} tabIndex={-1}>
        <ProductImage p={p} className="aspect-square w-full transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
        {/* On hover: the clip if there is one, else the second photo (usually the product in a room). */}
        {video ? (
          <ProductVideo
            src={video}
            poster={p.images[0]}
            playing={playing}
            label={`${p.title} in use`}
            className={cx('absolute inset-0 h-full w-full transition-opacity duration-500 motion-reduce:transition-none', playing ? 'opacity-100' : 'opacity-0')}
          />
        ) : second ? (
          <img src={second} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100 motion-reduce:transition-none" />
        ) : null}
        {video && (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 bg-white/90 px-2 py-1 text-[11px] font-semibold text-slate-900 shadow-sm">
            <Play size={11} className="fill-current" aria-hidden="true" /> See it working
          </span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">{[p.category, p.brand].filter(Boolean).join(' · ')}</p>
        {routed ? (
          <a href={productPath(p)} className="font-semibold leading-snug text-slate-900 hover:underline">{p.title}</a>
        ) : (
          <button className="text-left font-semibold leading-snug hover:underline" onClick={onOpen}>{p.title}</button>
        )}
        <ComplianceBadges p={p} small />
        {p.highlights?.[0] && <p className="line-clamp-2 text-sm text-slate-600">{p.highlights.slice(0, 2).join(' · ')}</p>}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <Price p={p} user={user} choice={cheapestChoice(p, user)} from={varies(p)} />
            <div className="mt-1"><Status tone={STOCK_TONE[p.stock]}>{STOCK_LABEL[p.stock]}</Status></div>
          </div>
          {hasOptions ? (
            <button className="btn-ghost px-3 py-1.5" disabled={p.stock === 'out_of_stock'} onClick={onOpen} aria-label={`Choose options for ${p.title}`}>Choose</button>
          ) : (
            <button className="btn-ghost px-3 py-1.5" disabled={p.stock === 'out_of_stock'} onClick={onAdd} aria-label={`Add ${p.title} to cart`}>
              <Plus size={15} /> Add
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

/** One option's choices: buttons for a few, a list for many. */
function OptionPicker({ p, user, g, value, onChange }: { p: Product; user: UserAccount | null; g: Product['options'][number]; value: string; onChange: (id: string) => void }) {
  const extra = (v: (typeof g.values)[number]) => addOn(v, p, user)
  const label = (v: (typeof g.values)[number]) => `${v.label}${extra(v) > 0 ? ` (+${money(extra(v))})` : ''}${v.available ? '' : ' (unavailable)'}`
  const id = `opt-${p.id}-${g.id}`
  if (g.values.length > 6) {
    return (
      <div>
        <label htmlFor={id} className="label">{g.name}</label>
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          {g.values.map((v) => <option key={v.id} value={v.id} disabled={!v.available}>{label(v)}</option>)}
        </select>
      </div>
    )
  }
  return (
    <fieldset>
      <legend className="label">
        {g.name}: <span className="normal-case tracking-normal text-slate-900">{g.values.find((v) => v.id === value)?.label}</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {g.values.map((v) => (
          <label
            key={v.id}
            className={cx(
              'cursor-pointer border px-3 py-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
              value === v.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white hover:border-slate-900',
              !v.available && 'cursor-not-allowed text-slate-400 line-through hover:border-slate-300',
            )}
          >
            <input type="radio" name={id} value={v.id} className="sr-only" checked={value === v.id} disabled={!v.available} onChange={() => onChange(v.id)} />
            {v.label}
            {extra(v) > 0 && <span className={cx('num ml-1', value === v.id ? 'text-white/80' : 'text-slate-500')}>+{money(extra(v))}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * A product's own page (and, in the portals, the product opened in place): photos, price, choices,
 * selling points, specifications, compliance details, delivery and returns, and related products.
 */
export function ProductView({
  p,
  user,
  choice,
  setChoice,
  related,
  onBack,
  onAdd,
  onViewCart,
  onOpen,
}: {
  p: Product
  user: UserAccount | null
  choice: Choice
  setChoice: (c: Choice) => void
  related: Product[]
  onBack: () => void
  onAdd: (qty: number, install: boolean) => void
  onViewCart: () => void
  onOpen: (p: Product) => void
}) {
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [install, setInstall] = useState(false)
  const videos = p.videos ?? []
  // A chosen finish's photo first, else what was picked, else the clip, else the first photo.
  const shown = choicePhoto(p, choice) && !photo ? choicePhoto(p, choice) : (photo ?? videos[0] ?? p.images[0])
  const showingVideo = !!shown && videos.includes(shown)
  const media = [...videos, ...p.images]
  const canBuy = p.stock !== 'out_of_stock' && choiceText(p, choice) !== null
  const facts = complianceFacts(p)
  const add = () => {
    onAdd(qty, install)
    setAdded(true)
  }

  return (
    <div className="pb-24 lg:pb-0">
      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
        <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-slate-900">
          <ArrowLeft size={15} aria-hidden="true" /> Shop
        </button>
        <span aria-hidden="true">/</span>
        <span>{p.category}</span>
        <span aria-hidden="true" className="hidden sm:inline">/</span>
        <span className="hidden truncate text-slate-700 sm:inline">{p.title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[7fr_5fr] lg:gap-12">
        <div className="min-w-0 space-y-3">
          <div className="border border-slate-200 bg-white">
            {showingVideo ? (
              <ProductVideo key={shown} src={shown!} poster={p.images[0]} playing controls label={`${p.title} in use`} className="aspect-square w-full" />
            ) : (
              <ProductImage p={p} src={shown} eager className="aspect-square w-full" />
            )}
          </div>
          {media.length > 1 && (
            <div className="grid grid-cols-5 gap-2" role="group" aria-label="Photos and videos">
              {media.map((src) => {
                const isVideo = videos.includes(src)
                const n = isVideo ? videos.indexOf(src) + 1 : p.images.indexOf(src) + 1
                return (
                  <button
                    key={src}
                    onClick={() => setPhoto(src)}
                    className={cx('relative border bg-white', shown === src ? 'border-slate-900' : 'border-slate-200 hover:border-slate-500')}
                    aria-label={isVideo ? `Play video ${n}` : `Show photo ${n}`}
                    aria-pressed={shown === src}
                  >
                    {isVideo && p.images[0] ? (
                      <img src={p.images[0]} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                    ) : isVideo ? (
                      <span className="block aspect-square w-full bg-slate-100" />
                    ) : (
                      <img src={src} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                    )}
                    {isVideo && (
                      <span className="absolute inset-0 flex items-center justify-center bg-slate-900/25" aria-hidden="true">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-900"><Play size={14} className="ml-0.5 fill-current" /></span>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {/* Photos and clips AI made (stored under photos/ai/ or videos/ai/) are said to be renders; real ones aren't. */}
          {media.some(isRender) && (
            <p className="text-xs text-slate-500">
              Some images{videos.some(isRender) ? ' and videos' : ''} are digital renders of this product; colours, finishes and water flow may vary slightly from what's shown.
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-ink">{[p.category, p.brand].filter(Boolean).join(' · ')}</p>
          <h1 className="mt-2 font-display text-2xl font-bold leading-tight text-balance sm:text-3xl">{p.title}</h1>
          {p.sku && <p className="mt-1 text-sm text-slate-500">Model <span className="num">{p.sku}</span></p>}
          <div className="mt-3"><ComplianceBadges p={p} /></div>

          <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Price p={p} user={user} choice={choice} large />
            <span className="text-sm text-slate-500">inc. GST</span>
          </div>
          <div className="mt-2"><Status tone={STOCK_TONE[p.stock]}>{STOCK_LABEL[p.stock]}</Status></div>

          {(p.options ?? []).length > 0 && (
            <div className="mt-6 space-y-4">
              {p.options.map((g) => (
                <OptionPicker key={g.id} p={p} user={user} g={g} value={choice[g.id] ?? ''} onChange={(id) => { setChoice({ ...choice, [g.id]: id }); setPhoto(undefined); setAdded(false) }} />
              ))}
            </div>
          )}

          <fieldset className="mt-6">
            <legend className="label">Installation</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { value: false, title: 'Supply only', body: 'Delivered or picked up; you arrange fitting.' },
                { value: true, title: 'Supply and install', body: "We'll quote the installation after you order." },
              ].map((o) => (
                <label
                  key={o.title}
                  className={cx(
                    'flex cursor-pointer gap-2.5 border p-3 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                    install === o.value ? 'border-slate-900 bg-white' : 'border-slate-300 bg-white hover:border-slate-900',
                  )}
                >
                  <input type="radio" name={`install-${p.id}`} className="mt-0.5 accent-slate-900" checked={install === o.value} onChange={() => { setInstall(o.value); setAdded(false) }} />
                  <span>
                    <span className="flex items-center gap-1.5 font-semibold text-slate-900">{o.value && <Wrench size={15} className="text-accent-ink" aria-hidden="true" />}{o.title}</span>
                    <span className="text-slate-600">{o.body}</span>
                  </span>
                </label>
              ))}
            </div>
            {install && (
              <p className="mt-2 text-xs text-slate-600">
                The product price is the same. Installation is priced separately: after you order, we'll review the job and send you a quote. Installs are done by licensed and insured trades, in metro Melbourne only. You only pay for installation if you accept it.
              </p>
            )}
          </fieldset>

          <div className="mt-5 flex flex-wrap items-stretch gap-3">
            <div className="flex items-center border border-slate-300 bg-white" role="group" aria-label="Quantity">
              <button type="button" className="px-3 py-2.5 hover:bg-slate-50 disabled:text-slate-300" onClick={() => setQty(Math.max(1, qty - 1))} disabled={qty <= 1} aria-label="One less"><Minus size={15} /></button>
              <span className="num w-8 text-center" aria-live="polite">{qty}</span>
              <button type="button" className="px-3 py-2.5 hover:bg-slate-50" onClick={() => setQty(Math.min(99, qty + 1))} aria-label="One more"><Plus size={15} /></button>
            </div>
            <button className="btn-accent flex-1 px-6 py-3 text-base" disabled={!canBuy} onClick={add}>
              <ShoppingCart size={18} /> Add to cart
            </button>
          </div>
          {added && (
            <p className="mt-3 flex flex-wrap items-center gap-3 text-sm" role="status">
              <span className="inline-flex items-center gap-1 text-emerald-700"><Check size={16} /> Added to your cart{install ? ', with installation to quote' : ''}</span>
              <button className="font-semibold underline underline-offset-2" onClick={onViewCart}>View cart and check out</button>
            </p>
          )}

          {(p.highlights ?? []).length > 0 && (
            <ul className="mt-6 space-y-2 text-[15px]">
              {p.highlights.map((h) => (
                <li key={h} className="flex gap-2"><Check size={18} className="mt-0.5 shrink-0 text-accent-ink" aria-hidden="true" />{h}</li>
              ))}
            </ul>
          )}

          <ul className="mt-6 grid gap-2 text-sm text-slate-600">
            <li className="flex gap-2"><Wrench size={17} className="shrink-0 text-slate-500" aria-hidden="true" /><span>Installation in metro Melbourne by licensed and insured trades, quoted after you order.</span></li>
            <li className="flex gap-2"><Truck size={17} className="shrink-0 text-slate-500" aria-hidden="true" /><span>Free pickup, Melbourne delivery in {STORE_POLICY.melbourneDeliveryDays} business days from ${STORE_POLICY.melbourneDeliveryFrom}, same-day in Melbourne once ready, or Australia-wide. <a href="/store/delivery" className="underline underline-offset-2 hover:text-slate-900">Delivery details</a></span></li>
            <li className="flex gap-2"><ShieldCheck size={17} className="shrink-0 text-slate-500" aria-hidden="true" /><span>{STORE_POLICY.changeOfMindDays}-day change-of-mind returns on unopened items. Australian Consumer Law guarantees apply. <a href="/store/returns" className="underline underline-offset-2 hover:text-slate-900">Returns and warranty</a></span></li>
          </ul>
        </div>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[7fr_5fr] lg:gap-12">
        <section className="min-w-0">
          <h2 className="rule-above font-display text-xl font-bold">About this product</h2>
          <div className="mt-4 max-w-prose space-y-3 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">{p.description}</div>
        </section>
        <div className="min-w-0 space-y-10">
          {(p.specs ?? []).length > 0 && (
            <section>
              <h2 className="rule-above font-display text-xl font-bold">Specifications</h2>
              <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200 text-sm">
                {p.specs.map((s, i) => (
                  <div key={`${s.label}-${i}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 py-2.5">
                    <dt className="text-slate-500">{s.label}</dt>
                    <dd className="text-slate-900">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {facts.length > 0 && (
            <section>
              <h2 className="rule-above font-display text-xl font-bold">Compliance and warranty</h2>
              <dl className="mt-4 divide-y divide-slate-200 border-y border-slate-200 text-sm">
                {facts.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 py-2.5">
                    <dt className="text-slate-500">{f.name}</dt>
                    <dd className="text-slate-900">{f.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs leading-relaxed text-slate-500">{ACL_GUARANTEE}</p>
            </section>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-14">
          <h2 className="rule-above font-display text-xl font-bold">More {p.category.toLowerCase()}</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {related.map((r) => (
              <button key={r.id} onClick={() => onOpen(r)} className="group text-left">
                <span className="block overflow-hidden border border-slate-200 bg-white">
                  <ProductImage p={r} className="aspect-square w-full transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
                </span>
                <span className="mt-2 block text-sm font-semibold leading-snug group-hover:underline">{r.title}</span>
                <span className="mt-1 block text-sm"><Price p={r} user={user} choice={cheapestChoice(r, user)} from={varies(r)} /></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* On phones the price and Add to cart stay in reach at the bottom of the screen. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-slate-500">{p.title}</p>
            <Price p={p} user={user} choice={choice} />
          </div>
          <button className="btn-accent px-5 py-2.5" disabled={!canBuy} onClick={added ? onViewCart : add}>
            <ShoppingCart size={16} /> {added ? 'View cart' : 'Add to cart'}
          </button>
        </div>
      </div>

    </div>
  )
}
