import { useEffect, useRef } from 'react'
import type {
  PresenterCandidate,
  PresenterScript,
} from '../lib/presenterScript'
import './presenter.css'

const EASE = 'cubic-bezier(.2,.7,.1,1)'
const SCENES = ['Read', 'Extract', 'Imagine', 'Judge', 'Choose', 'Defend']
const STAGE_WIDTH = 1600
const STAGE_HEIGHT = 900

type Controller = {
  play: () => void
  step: (delta: number) => void
  dispose: () => void
}

export function Presenter({
  script,
  onClose,
}: {
  script: PresenterScript
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const exitRef = useRef<HTMLButtonElement>(null)
  const controllerRef = useRef<Controller | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const stage = stageRef.current
    if (!root || !stage) return
    const controller = createController(root, stage, script)
    controllerRef.current = controller
    const fit = () => {
      const scale = Math.min(
        window.innerWidth / STAGE_WIDTH,
        window.innerHeight / STAGE_HEIGHT,
      )
      stage.style.transform = `translate(-50%, -50%) scale(${scale})`
    }
    fit()
    window.addEventListener('resize', fit)
    let disposed = false
    void document.fonts.ready.then(() => {
      if (!disposed) controller.play()
    })
    return () => {
      disposed = true
      window.removeEventListener('resize', fit)
      controller.dispose()
      controllerRef.current = null
    }
  }, [script])

  useEffect(() => {
    exitRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') controllerRef.current?.step(1)
      else if (event.key === 'ArrowLeft') controllerRef.current?.step(-1)
      else if (event.key === 'r' || event.key === 'R')
        controllerRef.current?.play()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      ref={rootRef}
      className="presenter"
      role="dialog"
      aria-modal="true"
      aria-label="Presenter: watch it think"
      data-testid="presenter"
    >
      <div className="p-fit">
        <div ref={stageRef} className="p-stage">
          <canvas className="p-grain" data-p="grain" width={512} height={512} />
          <div className="p-glow" data-p="glow" />
          <div className="p-abs p-brand">
            <b>Unfold</b>
            <span />
            <div className="p-eyebrow">Presenter</div>
          </div>
          <div className="p-abs p-live">
            <i />
            Replay of the saved run · {script.modelLabel}
          </div>
          <div
            className="p-abs p-eyebrow p-status"
            data-p="status"
            aria-live="polite"
          />
          <div className="p-abs p-prompt" data-p="prompt" />
          <div className="p-abs p-fence" data-p="fence" />
          <div className="p-abs p-fence-label" data-p="fenceLabel" />
          <div data-p="cards" />
          <div className="p-abs p-defend" data-p="defend">
            <div className="p-abs p-verdict">
              <span data-p="verdict" />
            </div>
            <div className="p-abs p-dtitle" data-p="dTitle" />
            <div className="p-abs p-defend-grid">
              <div className="p-col p-adv" data-p="adv">
                <h4>The case for it</h4>
                <p />
              </div>
              <div className="p-col p-crit" data-p="crit">
                <h4>Strongest objection</h4>
                <p />
              </div>
              <div className="p-col p-test" data-p="test">
                <h4>Answer: the first test</h4>
                <p />
              </div>
            </div>
          </div>
          <div className="p-abs p-log" data-p="log" />
          <div className="p-abs p-bar" data-p="bar">
            {SCENES.map((scene, index) => (
              <div key={scene}>
                0{index + 1} {scene}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="p-controls">
        <button
          type="button"
          aria-label="Previous direction"
          onClick={() => controllerRef.current?.step(-1)}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Next direction"
          onClick={() => controllerRef.current?.step(1)}
        >
          →
        </button>
        <button type="button" onClick={() => controllerRef.current?.play()}>
          Replay
        </button>
        <button ref={exitRef} type="button" onClick={onClose}>
          Exit
        </button>
      </div>
    </div>
  )
}

function createController(
  root: HTMLElement,
  stage: HTMLElement,
  script: PresenterScript,
): Controller {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const part = (name: string) => {
    const element = root.querySelector<HTMLElement>(`[data-p="${name}"]`)
    if (!element) throw new Error(`Missing presenter part ${name}`)
    return element
  }
  const promptEl = part('prompt')
  const cardsEl = part('cards')
  const logEl = part('log')
  const statusEl = part('status')
  const fenceEl = part('fence')
  const fenceLabelEl = part('fenceLabel')
  const glowEl = part('glow')
  const barEl = part('bar')
  const defendEl = part('defend')
  const grain = part('grain') as HTMLCanvasElement

  let timers: number[] = []
  let intervals: number[] = []
  const animations = new Set<Animation>()
  let phase: 'idle' | 'running' | 'defend' = 'idle'
  let current = 0

  paintGrain(grain)
  const grainAnimation = reduce
    ? null
    : grain.animate(
        [
          { transform: 'translate(0,0)' },
          { transform: 'translate(-3%,2%)' },
          { transform: 'translate(2%,-3%)' },
          { transform: 'translate(-1%,1%)' },
        ],
        { duration: 400, iterations: Infinity, easing: 'steps(4)' },
      )

  const animate = (
    target: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions = {},
  ) => {
    const animation = target.animate(keyframes, {
      fill: 'both',
      easing: EASE,
      ...options,
      ...(reduce ? { duration: 0, delay: 0 } : {}),
    })
    animations.add(animation)
    return animation
  }
  const at = (seconds: number, run: () => void) => {
    timers.push(window.setTimeout(run, reduce ? 0 : seconds * 1000))
  }
  const later = (ms: number, run: () => void) => {
    timers.push(window.setTimeout(run, reduce ? 0 : ms))
  }
  const clearAll = () => {
    timers.forEach((id) => window.clearTimeout(id))
    intervals.forEach((id) => window.clearInterval(id))
    timers = []
    intervals = []
    animations.forEach((animation) => animation.cancel())
    animations.clear()
  }
  const type = (
    target: HTMLElement,
    text: string,
    ms: number,
    caret = false,
  ) => {
    const write = (count: number) => {
      target.textContent = text.slice(0, count)
      if (caret) {
        const mark = document.createElement('span')
        mark.className = 'p-caret'
        target.appendChild(mark)
      }
    }
    if (reduce || !text.length) {
      write(text.length)
      return
    }
    const perTick = Math.max(1, Math.ceil((text.length * 16) / ms))
    let count = 0
    const id = window.setInterval(() => {
      count = Math.min(text.length, count + perTick)
      write(count)
      if (count >= text.length) window.clearInterval(id)
    }, 16)
    intervals.push(id)
  }
  const log = (label: string, rest: string) => {
    const line = document.createElement('div')
    const bold = document.createElement('b')
    bold.textContent = label
    line.append(bold, ` ${rest}`)
    logEl.appendChild(line)
    animate(
      line,
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 400 },
    )
    while (logEl.children.length > 2) logEl.firstChild?.remove()
  }
  const status = (text: string, top = 250) => {
    statusEl.style.top = `${top}px`
    statusEl.textContent = text
    animate(
      statusEl,
      [
        { opacity: 0, letterSpacing: '.3em' },
        { opacity: 1, letterSpacing: '.14em' },
      ],
      { duration: 700 },
    )
  }
  const glow = (x: number, y: number, duration = 1400) => {
    animate(glowEl, [{}, { left: `${x}px`, top: `${y}px` }], { duration })
  }
  const scene = (index: number, seconds: number) => {
    const bars = [...barEl.children] as HTMLElement[]
    bars.forEach((bar, position) => {
      bar.classList.toggle('on', position === index)
      if (position < index) bar.style.setProperty('--p', '100%')
      if (position > index) bar.style.setProperty('--p', '0%')
    })
    const bar = bars[index]
    if (!bar) return
    if (reduce) {
      bar.style.setProperty('--p', '100%')
      return
    }
    const started = performance.now()
    const id = window.setInterval(() => {
      const progress = Math.min(
        100,
        (performance.now() - started) / (seconds * 10),
      )
      bar.style.setProperty('--p', `${progress}%`)
      if (progress >= 100) window.clearInterval(id)
    }, 50)
    intervals.push(id)
  }

  const candidates = script.candidates
  const columns = candidates.length <= 6 ? 3 : 4
  const cardWidth = columns === 3 ? 440 : 340
  const gridLeft =
    (STAGE_WIDTH - (columns * cardWidth + (columns - 1) * 40)) / 2
  const position = (index: number) => ({
    x: gridLeft + (index % columns) * (cardWidth + 40),
    y: 266 + Math.floor(index / columns) * 236,
  })
  const cardFor = (candidate: PresenterCandidate) =>
    cardsEl.querySelector<HTMLElement>(`[data-card="${candidate.id}"]`)

  const resetDom = () => {
    promptEl.textContent = ''
    promptEl.className = 'p-abs p-prompt'
    promptEl.style.fontSize = promptFontSize(script.prompt)
    cardsEl.replaceChildren()
    logEl.replaceChildren()
    statusEl.textContent = ''
    for (const name of ['adv', 'crit', 'test']) {
      const paragraph = part(name).querySelector('p')
      if (paragraph) paragraph.textContent = ''
    }
    part('dTitle').textContent = ''
    part('verdict').textContent = ''
    for (const bar of [...barEl.children] as HTMLElement[]) {
      bar.classList.remove('on')
      bar.style.setProperty('--p', '0%')
    }
    fenceLabelEl.replaceChildren(...fenceLabelNodes(script))
    fenceEl.classList.toggle('is-empty', !script.hardConstraints.length)
  }

  const showDefend = (index: number, intro: boolean) => {
    phase = 'defend'
    current = index
    const direction = script.selected[index]
    if (!direction) return
    const offset = intro ? 1 : 0.35
    for (const element of [
      defendEl,
      part('dTitle'),
      part('adv'),
      part('crit'),
      part('test'),
      part('verdict'),
    ]) {
      element.getAnimations().forEach((animation) => animation.cancel())
    }
    const title = part('dTitle')
    title.textContent = direction.title
    title.style.fontSize = direction.title.length > 80 ? '46px' : '56px'
    part('verdict').textContent =
      `Direction ${pad(index + 1)} of ${pad(script.selected.length)} · the case, the critic, the test`
    const panelSize = textSize(
      Math.max(
        direction.fitRationale.length,
        direction.strongestObjection.length,
      ),
      [
        [110, '26px'],
        [200, '22px'],
      ],
      '19px',
    )
    for (const name of ['adv', 'crit'] as const) {
      const paragraph = part(name).querySelector('p')
      if (paragraph) {
        paragraph.textContent = ''
        paragraph.style.fontSize = panelSize
      }
    }
    const testParagraph = part('test').querySelector('p')
    if (testParagraph) {
      testParagraph.textContent = ''
      testParagraph.style.fontSize =
        direction.firstTest.length > 160 ? '20px' : '23px'
    }
    animate(defendEl, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 10,
      delay: intro ? 500 : 0,
    })
    animate(logEl, [{}, { opacity: 0 }], { duration: 600 })
    animate(
      title,
      [
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 1100, delay: (offset - 0.4) * 1000 },
    )
    animate(
      part('verdict'),
      [
        { opacity: 0, transform: 'translateY(-8px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 700, delay: offset * 1000 },
    )
    at(offset + 0.9, () => {
      animate(
        part('adv'),
        [
          { opacity: 0, transform: 'translateX(-40px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 800 },
      )
      const paragraph = part('adv').querySelector('p')
      if (paragraph) type(paragraph, direction.fitRationale, 1400)
      glow(450, 520, 900)
    })
    at(offset + 3.1, () => {
      animate(
        part('crit'),
        [
          { opacity: 0, transform: 'translateX(120px) scale(1.04)' },
          { opacity: 1, transform: 'translateX(-14px)', offset: 0.7 },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 650, easing: 'cubic-bezier(.2,.9,.2,1)' },
      )
      animate(
        part('adv'),
        [
          { transform: 'none' },
          { transform: 'translateX(-10px)' },
          { transform: 'none' },
        ],
        { duration: 380, delay: 430, fill: 'none' },
      )
      const paragraph = part('crit').querySelector('p')
      if (paragraph) type(paragraph, direction.strongestObjection, 1500)
      glow(1150, 520, 700)
    })
    at(offset + 5.6, () => {
      animate(
        part('test'),
        [
          { opacity: 0, transform: 'translateY(30px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 800 },
      )
      const paragraph = part('test').querySelector('p')
      if (paragraph) type(paragraph, direction.firstTest, 1600)
      glow(800, 700, 900)
    })
  }

  const jumpToDefend = (index: number) => {
    clearAll()
    resetDom()
    for (const bar of [...barEl.children] as HTMLElement[]) {
      bar.style.setProperty('--p', '100%')
    }
    barEl.children[5]?.classList.add('on')
    animate(fenceEl, [{ transform: 'scaleX(1)', opacity: 0.35 }], {
      duration: 1,
    })
    animate(fenceLabelEl, [{ opacity: 1 }], { duration: 1 })
    showDefend(index, false)
  }

  const play = () => {
    clearAll()
    resetDom()
    phase = 'running'
    const facts = script.facts.slice(0, 2)
    const hard = script.hardConstraints
    const n = candidates.length
    const imagineSeconds = Math.max(6, n * 0.42 + 2.4)
    const sunk = candidates.filter(
      (candidate) =>
        candidate.outcome === 'REJECTED' || candidate.outcome === 'DUPLICATE',
    )
    const judgeSeconds = Math.max(6, n * 0.52 + 1.6 + sunk.length * 0.5)
    const judgeAt = 8.2 + imagineSeconds
    const chooseAt = judgeAt + judgeSeconds
    const defendAt = chooseAt + 5.8

    at(0.3, () => {
      scene(0, 3.6)
      status('Reading your prompt')
      type(
        promptEl,
        script.prompt,
        Math.min(2600, script.prompt.length * 25),
        true,
      )
    })

    at(3.9, () => {
      scene(1, 4)
      status('Separating what you said from what must not break')
      promptEl.replaceChildren(
        ...script.segments.map((segment) => {
          const span = document.createElement('span')
          span.className = `p-w p-${segment.kind}`
          span.textContent = segment.text
          if (segment.ref) span.dataset.ref = segment.ref
          return span
        }),
      )
      promptEl.classList.add('is-parsed')
      ;[...promptEl.querySelectorAll<HTMLElement>('.p-fact, .p-soft')].forEach(
        (span, index) => later(120 * index, () => span.classList.add('on')),
      )
      for (const fact of facts) {
        log(fact.ref, `fact · “${clip(fact.evidence, 64)}”`)
      }
      if (!facts.length) log('extract', 'no explicit facts found')
    })

    at(5.2, () => {
      const stageBox = stage.getBoundingClientRect()
      const scale = stageBox.width / STAGE_WIDTH
      ;[...promptEl.querySelectorAll<HTMLElement>('.p-hard')].forEach(
        (span) => {
          span.classList.add('on')
          const box = span.getBoundingClientRect()
          const flyer = document.createElement('div')
          flyer.className = 'p-flyer'
          flyer.textContent = span.textContent
          const left = (box.left - stageBox.left) / scale
          const top = (box.top - stageBox.top) / scale
          flyer.style.left = `${left}px`
          flyer.style.top = `${top}px`
          flyer.style.fontSize = promptEl.style.fontSize
          cardsEl.appendChild(flyer)
          animate(
            flyer,
            [
              { opacity: 1 },
              {
                transform: `translate(${60 - left}px,${752 - top}px) scale(.3)`,
                opacity: 0,
              },
            ],
            { duration: 1300, easing: 'cubic-bezier(.6,0,.2,1)' },
          )
        },
      )
      later(1100, () => {
        animate(
          fenceEl,
          [
            { transform: 'scaleX(0)', opacity: 0 },
            { transform: 'scaleX(1)', opacity: 1 },
          ],
          { duration: 1100 },
        )
        animate(
          fenceLabelEl,
          [
            { opacity: 0, transform: 'translateX(-12px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 700, delay: 400 },
        )
        glow(800, 780, 1200)
      })
      const first = hard[0]
      if (first)
        log(
          first.ref,
          `hard constraint · “${clip(first.text, 48)}” — every idea must stay inside this line`,
        )
      else log('constraints', 'no hard constraints in this prompt')
    })

    at(7.2, () => {
      animate(
        promptEl,
        [{}, { transform: 'translateY(-232px) scale(.5)', opacity: 0.9 }],
        { duration: 1100 },
      )
      glow(800, 420, 1400)
    })

    at(8.2, () => {
      scene(2, imagineSeconds)
      status(`Imagining ${n} different directions`)
      candidates.forEach((candidate, index) => {
        const card = buildCard(candidate, columns === 4)
        const { x, y } = position(index)
        card.style.left = `${x}px`
        card.style.top = `${y}px`
        card.style.width = `${cardWidth}px`
        cardsEl.appendChild(card)
        later(index * 420, () => {
          animate(
            card,
            [
              { opacity: 0, transform: 'translateY(18px) scale(.94)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 900 },
          )
          const title = card.querySelector<HTMLElement>('.p-t')
          if (title) type(title, candidate.title, 1700)
        })
      })
      log('generate', `${n} candidates · every one schema-validated`)
    })

    at(judgeAt, () => {
      scene(3, judgeSeconds)
      status('Judging every idea against your words')
      candidates.forEach((candidate, index) => {
        const card = cardFor(candidate)
        if (!card) return
        later(index * 520, () => {
          const scan = card.querySelector('.p-scan')
          if (scan)
            animate(scan, [{ left: '-140px' }, { left: '460px' }], {
              duration: 900,
              easing: 'linear',
            })
          ;[...card.querySelectorAll<HTMLElement>('.p-chk')].forEach(
            (chip, chipIndex) =>
              later(150 + chipIndex * 130, () => {
                chip.classList.add(`is-${chip.dataset.state}`)
                animate(chip, [{ opacity: 0 }, { opacity: 1 }], {
                  duration: 300,
                })
              }),
          )
          later(900, () => {
            const score = card.querySelector('.p-q')
            if (score)
              animate(score, [{ opacity: 0 }, { opacity: 1 }], {
                duration: 300,
              })
          })
        })
      })
      log(
        'evaluate',
        `${script.rubricVersion ?? 'rubric'} · every candidate scored, every hard constraint checked`,
      )
      sunk.forEach((candidate, index) =>
        later((n * 0.52 + 1.2 + index * 0.5) * 1000, () => {
          const card = cardFor(candidate)
          const stamp = card?.querySelector<HTMLElement>('.p-stamp')
          if (!card || !stamp) return
          stamp.textContent = candidate.stamp
          animate(
            stamp,
            [
              { opacity: 0, transform: 'rotate(-6deg) scale(1.8)' },
              { opacity: 1, transform: 'rotate(-6deg) scale(1)' },
            ],
            { duration: 260, easing: 'cubic-bezier(.3,1.6,.5,1)' },
          )
          animate(
            card,
            [
              { transform: 'none' },
              { transform: 'translateX(-5px)' },
              { transform: 'translateX(4px)' },
              { transform: 'none' },
            ],
            { duration: 260, delay: 200, fill: 'none' },
          )
          log(
            'reject',
            `candidate ${pad(candidate.ordinal)} · ${(candidate.stamp ?? '').toLowerCase()}`,
          )
          later(700, () => card.classList.add('is-sunk'))
        }),
      )
    })

    at(chooseAt, () => {
      scene(4, 5)
      status('Choosing the strongest set with the least overlap', 640)
      for (const candidate of sunk) {
        const card = cardFor(candidate)
        if (card)
          animate(
            card,
            [{}, { opacity: 0, transform: 'translateY(30px) scale(.94)' }],
            { duration: 700 },
          )
      }
      for (const candidate of candidates.filter(
        (item) => item.outcome === 'NOT_SELECTED',
      )) {
        const card = cardFor(candidate)
        if (!card) continue
        const stamp = card.querySelector<HTMLElement>('.p-stamp')
        if (stamp) {
          stamp.textContent = candidate.stamp
          stamp.classList.add('is-neutral')
          animate(stamp, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 })
        }
        card.classList.add('is-sunk')
        animate(
          card,
          [
            {},
            {
              opacity: 0.18,
              filter: 'grayscale(1) blur(1px)',
              transform: 'scale(.96)',
            },
          ],
          { duration: 900 },
        )
        animate(
          card,
          [{}, { opacity: 0, transform: 'translateY(30px) scale(.94)' }],
          { duration: 900, delay: 1500 },
        )
      }
      log(
        'select',
        `${script.policyVersion} · quality first, minus overlap with earlier picks`,
      )
      const picks = script.selected
      const rowWidth = picks.length * 340 + (picks.length - 1) * 33
      const rowLeft = (STAGE_WIDTH - rowWidth) / 2
      picks.forEach((candidate, index) =>
        later(400 + index * 650, () => {
          const card = cardFor(candidate)
          if (!card) return
          card.classList.add('is-picked')
          const targetX = rowLeft + index * 373
          const dx = targetX - parseFloat(card.style.left)
          const dy = 300 - parseFloat(card.style.top)
          animate(
            card,
            [
              {},
              {
                transform: `translate(${dx}px,${dy}px)`,
                width: '340px',
                height: '270px',
              },
            ],
            { duration: 1100, easing: 'cubic-bezier(.7,0,.2,1)' },
          )
          later(900, () => {
            const footer = card.querySelector<HTMLElement>('.p-ft')
            if (!footer) return
            const score = document.createElement('span')
            score.className = 'p-pick-score'
            score.textContent =
              candidate.selectionScore === null
                ? 'Selected'
                : `Selection score ${candidate.selectionScore.toFixed(3)}`
            const quality = document.createElement('span')
            quality.className = 'p-pick-q'
            quality.textContent = `Q ${candidate.q.toFixed(2)}`
            footer.replaceChildren(score, quality)
            animate(footer, [{ opacity: 0 }, { opacity: 1 }], {
              duration: 500,
            })
          })
          const number = document.createElement('div')
          number.className = 'p-big'
          number.textContent = pad(index + 1)
          number.style.left = `${targetX}px`
          number.style.top = '200px'
          cardsEl.appendChild(number)
          animate(
            number,
            [
              { opacity: 0, transform: 'translateY(20px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 800, delay: 600 },
          )
          log(
            `pick ${index + 1}`,
            `candidate ${pad(candidate.ordinal)}${candidate.selectionScore === null ? '' : ` · selection score ${candidate.selectionScore.toFixed(3)}`}`,
          )
        }),
      )
      glow(800, 420, 1000)
    })

    at(defendAt, () => {
      scene(5, 10)
      status('')
      animate(
        cardsEl,
        [{}, { opacity: 0, transform: 'translateY(40px) scale(.97)' }],
        { duration: 800 },
      )
      animate(promptEl, [{}, { opacity: 0 }], { duration: 600 })
      animate(fenceEl, [{}, { opacity: 0.35 }], { duration: 600 })
      showDefend(0, true)
    })
  }

  return {
    play,
    step: (delta) => {
      const total = script.selected.length
      if (phase !== 'defend') {
        jumpToDefend(delta < 0 ? total - 1 : 0)
        return
      }
      jumpToDefend((current + delta + total) % total)
    },
    dispose: () => {
      clearAll()
      grainAnimation?.cancel()
    },
  }
}

function buildCard(candidate: PresenterCandidate, compact: boolean) {
  const card = document.createElement('div')
  card.className = compact ? 'p-card is-compact' : 'p-card'
  card.dataset.card = candidate.id
  const header = document.createElement('div')
  header.className = 'p-hd'
  const label = document.createElement('span')
  label.className = 'p-n'
  label.textContent = `Candidate ${pad(candidate.ordinal)}${candidate.distance ? ` · ${candidate.distance}` : ''}`
  const score = document.createElement('span')
  score.className = 'p-q'
  score.textContent = `Q ${candidate.q.toFixed(2)}`
  header.append(label, score)
  const title = document.createElement('div')
  title.className = 'p-t'
  const footer = document.createElement('div')
  footer.className = 'p-ft'
  footer.append(
    ...candidate.checks.map((check) => {
      const chip = document.createElement('span')
      chip.className = 'p-chk'
      chip.dataset.state = check.state
      chip.append(document.createElement('i'), check.label)
      return chip
    }),
  )
  const scan = document.createElement('div')
  scan.className = 'p-scan'
  const stamp = document.createElement('div')
  stamp.className = 'p-stamp'
  card.append(header, title, footer, scan, stamp)
  return card
}

function fenceLabelNodes(script: PresenterScript) {
  const hard = script.hardConstraints.slice(0, 2)
  const label = document.createElement('span')
  if (!hard.length) {
    label.textContent = 'No hard constraints in this prompt'
    return [label]
  }
  label.textContent = `${hard.length > 1 ? 'Hard constraints' : 'Hard constraint'} · ${hard.map((item) => item.ref).join(' ')}`
  const text = document.createElement('em')
  text.textContent = hard.map((item) => clip(item.text, 40)).join(' · ')
  return [label, text]
}

function paintGrain(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return
  const image = context.createImageData(canvas.width, canvas.height)
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.random() * 255
    image.data[index] = value
    image.data[index + 1] = value
    image.data[index + 2] = value
    image.data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
}

function promptFontSize(prompt: string) {
  return textSize(
    prompt.length,
    [
      [110, '62px'],
      [200, '48px'],
      [320, '38px'],
    ],
    '30px',
  )
}

function textSize(
  length: number,
  steps: Array<[number, string]>,
  fallback: string,
) {
  return steps.find(([limit]) => length <= limit)?.[1] ?? fallback
}

function clip(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}
