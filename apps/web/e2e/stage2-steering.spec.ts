import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const evidenceDirectory = resolve('e2e-evidence')

for (const width of [1280, 1440]) {
  test.describe(`Stage 2 steering at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 1440 ? 900 : 800 } })

    test('exercises operators, steering, failures, and persisted state', async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name === 'mobile', 'Stage 2 desktop-only flow')
      await mkdir(evidenceDirectory, { recursive: true })
      const consoleErrors: string[] = []
      page.on('console', (entry) => {
        if (entry.type() === 'error') consoleErrors.push(entry.text())
      })
      page.on('pageerror', (error) => consoleErrors.push(error.message))

      const capture = (step: string) =>
        page.screenshot({
          path: resolve(evidenceDirectory, `stage2-${width}-${step}.png`),
          fullPage: true,
        })
      const expand = async (label: string) => {
        const button = page.getByRole('button', {
          name: new RegExp(label, 'i'),
        })
        await expect(button).toBeEnabled()
        await button.click()
        await expect(
          page.getByText(
            /New directions added|No candidates met the quality bar/,
          ),
        ).toBeVisible()
        await capture(`operator-${label.toLowerCase()}`)
      }

      await page.goto('/')
      await page
        .getByRole('textbox', { name: 'Your prompt' })
        .fill(
          'I want to test whether my neighborhood can support a bakery that helps busy families.',
        )
      await page.getByRole('button', { name: 'Unfold' }).click()
      await expect(page.getByTestId('graph-node-idea').first()).toBeVisible()
      await capture('initial-graph')

      await page.getByTestId('graph-node-idea').first().click()
      await expect(page.getByTestId('inspector-panel')).toBeVisible()
      await capture('inspector')
      await page.getByRole('button', { name: 'Pin', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Unpin' })).toBeVisible()
      await capture('pinned')
      await page.getByRole('button', { name: 'Set active' }).click()
      await expect(
        page.getByText('Active', { exact: true }).first(),
      ).toBeVisible()
      await capture('active')

      await expand('Ground')
      await expand('Reframe')
      await expand('Leap')
      await page.getByLabel('Assumption to invert').selectOption({ index: 1 })
      await capture('invert-assumption-selected')
      await expand('Invert')
      await expand('Transplant')

      await page
        .getByRole('textbox', { name: 'Your prompt' })
        .fill('I want to test a neighborhood bakery with a new model.')
      await page.getByLabel('Mock scenario').selectOption('operator-gaps')
      await page.getByRole('button', { name: 'Unfold' }).click()
      await expect(page.getByTestId('graph-node-idea').first()).toBeVisible()
      const ideaCards = page.getByTestId('graph-node-idea')
      let gapsNodeFound = false
      for (let index = 0; index < (await ideaCards.count()); index += 1) {
        await ideaCards.nth(index).click()
        const invertButton = page.getByRole('button', { name: /^Invert/i })
        const transplantButton = page.getByRole('button', {
          name: /^Transplant/i,
        })
        if (
          (await invertButton.isDisabled()) &&
          (await transplantButton.isDisabled())
        ) {
          gapsNodeFound = true
          break
        }
      }
      expect(gapsNodeFound).toBe(true)
      await expect(
        page.getByText(/doesn't state a concrete assumption/i),
      ).toBeVisible()
      await expect(
        page.getByText(/no concrete mechanism to transplant/i),
      ).toBeVisible()
      await capture('operator-gaps-disabled-reasons')

      const rejectedCard = page.getByTestId('graph-node-idea').first()
      const visibleCountBeforeReject = await page
        .getByTestId('graph-node-idea')
        .count()
      await rejectedCard.click()
      await page.getByRole('button', { name: 'Reject', exact: true }).click()
      await expect(page.getByTestId('graph-node-idea')).toHaveCount(
        visibleCountBeforeReject - 1,
      )
      await capture('rejected-hidden')
      await page
        .getByRole('button', { name: 'Reveal rejected and archived' })
        .click()
      await expect(page.locator('.graph-card.status-rejected')).toBeVisible()
      await capture('rejected-revealed')

      const editCard = page.getByTestId('graph-node-idea').nth(1)
      await editCard.click()
      const editedTitle = `Edited bakery direction ${width}`
      await page.getByLabel('Title', { exact: true }).fill(editedTitle)
      await page.getByRole('button', { name: 'Save edits' }).click()
      await expect(page.getByText('Changes saved.')).toBeVisible()
      await capture('edited')
      if (await page.getByRole('button', { name: 'Set active' }).count()) {
        await page.getByRole('button', { name: 'Set active' }).click()
      }
      await expect(
        page.getByText('Active', { exact: true }).first(),
      ).toBeVisible()
      await capture('active-after-edit')

      const nodeCount = await page.getByTestId('graph-node-idea').count()
      const edgeCount = await page.locator('.react-flow__edge').count()
      await page.reload()
      await expect(page.getByTestId('inspector-panel')).toBeVisible()
      await expect(
        page.getByRole('heading', { name: editedTitle }),
      ).toBeVisible()
      await expect(page.getByText('Status: rejected')).toBeVisible()
      await expect(
        page.getByText('Active', { exact: true }).first(),
      ).toBeVisible()
      await expect(page.getByTestId('graph-node-idea')).toHaveCount(nodeCount)
      await expect(page.locator('.react-flow__edge')).toHaveCount(edgeCount)
      await capture('reload-restored')

      await page.getByLabel('Mock scenario').selectOption('provider-error')
      await page.getByRole('button', { name: /^Ground/i }).click()
      await expect(page.getByText('Expansion failed.')).toBeVisible()
      await expect(page.getByTestId('graph-node-idea')).toHaveCount(nodeCount)
      await expect(page.locator('.react-flow__edge')).toHaveCount(edgeCount)
      await capture('provider-error-no-graph-change')
      expect(consoleErrors).toEqual([])
    })
  })
}
