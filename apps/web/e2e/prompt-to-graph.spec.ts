import { expect, test, type Locator } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const evidenceDirectory = resolve('e2e-evidence')

test.beforeAll(() => {
  mkdirSync(evidenceDirectory, { recursive: true })
})

test('creates, inspects, and restores a prompt graph', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === 'mobile'
      ? { width: 375, height: 812 }
      : { width: 1280, height: 800 },
  )
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Unfold' })).toBeVisible()
  await expect(page.getByTestId('mock-model-badge')).toBeVisible()
  await page
    .getByLabel('Your prompt')
    .fill(
      'I want to explore a neighborhood bakery idea for people who need a welcoming place to meet.',
    )
  await page.getByRole('button', { name: 'Unfold', exact: true }).click()

  const graphNodes = page.locator(
    '[data-testid="graph-canvas"] .react-flow__node',
  )
  await expect(graphNodes).toHaveCount(5, { timeout: 30_000 })
  await expect(page.getByTestId('graph-node-root')).toContainText('Your prompt')
  await page.screenshot({
    path: resolve(evidenceDirectory, `${testInfo.project.name}-graph.png`),
    fullPage: true,
  })

  await page.getByTestId('graph-node-idea').first().locator('button').click()
  if (testInfo.project.name === 'mobile') {
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.getByRole('heading', { name: 'Summary' })).toBeVisible()
    const closeButton = page.getByRole('button', { name: 'Close inspector' })
    await expect(closeButton).toBeFocused()
    await expect(page.locator('body')).toHaveCSS('overflow-x', 'hidden')
    await page.keyboard.press('Shift+Tab')
    await expect(closeButton).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(closeButton).toBeFocused()
    await page.screenshot({
      path: resolve(evidenceDirectory, 'mobile-inspector-dialog.png'),
      fullPage: true,
    })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } else {
    const inspector = page.getByTestId('inspector-panel')
    await expect(inspector).toBeVisible()
    await expectInspectorSections(inspector)
    await page.screenshot({
      path: resolve(evidenceDirectory, 'desktop-inspector.png'),
      fullPage: true,
    })
    await expect(page).toHaveURL(/project=.*&node=/)
    await page.reload()
    await expect(graphNodes).toHaveCount(5, { timeout: 30_000 })
    await expect(page.getByTestId('inspector-panel')).toBeVisible()
    await expectInspectorSections(page.getByTestId('inspector-panel'))
    await page.screenshot({
      path: resolve(evidenceDirectory, 'desktop-after-reload.png'),
      fullPage: true,
    })
  }
})

test('keeps the root prompt visible when generation fails', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === 'mobile',
    'Failure screenshot is desktop evidence',
  )
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByLabel('Mock scenario').selectOption('provider-error')
  await page
    .getByLabel('Your prompt')
    .fill('I want to test whether my neighborhood can support a bakery.')
  await page.getByRole('button', { name: 'Unfold', exact: true }).click()

  await expect(page.getByTestId('failure-state')).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.getByRole('heading', { name: 'We couldn’t unfold this prompt' }),
  ).toBeVisible()
  await expect(
    page.locator('[data-testid="graph-canvas"] .react-flow__node'),
  ).toHaveCount(1)
  await expect(page.getByTestId('graph-node-root')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  await page.screenshot({
    path: resolve(evidenceDirectory, 'failure-state.png'),
    fullPage: true,
  })
})

async function expectInspectorSections(inspector: Locator) {
  for (const name of [
    'Summary',
    'Preserved intent',
    'Changed assumptions',
    'Why it might fit',
    'Strongest objection',
    'First test',
    'Mechanism',
    'Facets',
    'Hypothesis — not confirmed intent',
    'Constraint uncertainty',
  ]) {
    await expect(inspector.getByRole('heading', { name })).toBeVisible()
  }
}
