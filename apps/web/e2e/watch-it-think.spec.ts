import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const evidenceDirectory = resolve('e2e-evidence')
const prompt =
  'I want to explore a neighborhood bakery idea for people who need a welcoming place to meet.'

test('opens Watch it think and builds a fork on a direction', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop presenter flow')
  test.setTimeout(120_000)
  await mkdir(evidenceDirectory, { recursive: true })

  const consoleErrors: string[] = []
  page.on('console', (entry) => {
    if (entry.type() === 'error') consoleErrors.push(entry.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByTestId('mock-model-badge')).toBeVisible()
  await page.getByLabel('Your prompt').fill(prompt)
  await page.getByRole('button', { name: 'Unfold', exact: true }).click()

  const presenter = page.getByTestId('presenter')
  await expect(presenter).toBeVisible()
  const options = page.locator('.p-option')
  await expect
    .poll(() => options.count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(2)
  const initialTitles = await options
    .locator('.p-option-title')
    .allTextContents()
  expect(initialTitles).toHaveLength(await options.count())
  await expect(options.locator('.p-suggested')).toHaveCount(1)
  await page.screenshot({
    path: resolve(evidenceDirectory, 'watch-it-think-initial-options.png'),
    fullPage: true,
  })

  const selectedTitle = initialTitles[1]!
  await options.nth(1).click()
  const pathButtons = page.locator('.p-path button')
  await expect(pathButtons).toHaveCount(2, { timeout: 60_000 })
  await expect(pathButtons.nth(1)).toContainText(selectedTitle)
  await expect
    .poll(() => options.count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(1)
  const childTitles = await options.locator('.p-option-title').allTextContents()
  expect(childTitles.length).toBeGreaterThanOrEqual(1)
  await page.screenshot({
    path: resolve(evidenceDirectory, 'watch-it-think-fork-path.png'),
    fullPage: true,
  })

  await expect(pathButtons.nth(0)).toContainText('Your prompt')
  await pathButtons.nth(0).click()
  await expect
    .poll(() => options.locator('.p-option-title').allTextContents())
    .toEqual(initialTitles)
  await page.getByRole('button', { name: 'Exit', exact: true }).click()
  await expect(presenter).toHaveCount(0)

  const root = page.getByTestId('graph-node-root')
  const ideas = page.getByTestId('graph-node-idea')
  await expect(root).toContainText(prompt)
  await expect.poll(() => ideas.count()).toBeGreaterThan(initialTitles.length)
  const graphTitles = ideas.locator('.graph-card-title')
  for (const title of [...initialTitles, ...childTitles]) {
    await expect(graphTitles.getByText(title, { exact: true })).toHaveCount(1)
  }
  await page.screenshot({
    path: resolve(evidenceDirectory, 'watch-it-think-fork-graph.png'),
    fullPage: true,
  })
  expect(consoleErrors).toEqual([])
})
