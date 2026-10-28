import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { submitPrompt } from './helpers'

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
        })
      const expand = async (label: string) => {
        const nodesBefore = await page.getByTestId('graph-node-idea').count()
        const edgesBefore = await page.locator('.react-flow__edge').count()
        const button = page.getByRole('button', {
          name: new RegExp(label, 'i'),
        })
        await expect(button).toBeEnabled()
        await button.click()
        const successNotice = page.getByRole('status').filter({
          hasText: 'New directions added.',
        })
        await expect(successNotice).toBeVisible()
        expect(
          parseFloat(
            await successNotice.evaluate(
              (element) => getComputedStyle(element).paddingTop,
            ),
          ),
        ).toBeGreaterThan(0)
        await expect
          .poll(() => page.getByTestId('graph-node-idea').count())
          .toBeGreaterThan(nodesBefore)
        await expect
          .poll(() => page.locator('.react-flow__edge').count())
          .toBeGreaterThan(edgesBefore)
        const nodesAfter = await page.getByTestId('graph-node-idea').count()
        const edgesAfter = await page.locator('.react-flow__edge').count()
        const nodeDelta = nodesAfter - nodesBefore
        expect(nodeDelta).toBeGreaterThanOrEqual(1)
        expect(nodeDelta).toBeLessThanOrEqual(3)
        expect(edgesAfter - edgesBefore).toBe(nodeDelta)
        const operatorCards = page
          .getByTestId('graph-node-idea')
          .filter({ hasText: new RegExp(label, 'i') })
        expect(await operatorCards.count()).toBe(nodeDelta)
        await page.locator('.react-flow__controls-fitview').click()
        const graph = page.locator('.workspace-graph')
        const graphBounds = await graph.boundingBox()
        expect(graphBounds).not.toBeNull()
        const visibleChildren = await Promise.all(
          Array.from({ length: await operatorCards.count() }, (_, index) =>
            operatorCards.nth(index).boundingBox(),
          ),
        )
        const childBounds = visibleChildren.filter(
          (bounds): bounds is NonNullable<typeof bounds> => bounds !== null,
        )
        const childCenter = {
          x:
            (Math.min(...childBounds.map((bounds) => bounds.x)) +
              Math.max(
                ...childBounds.map((bounds) => bounds.x + bounds.width),
              )) /
            2,
          y:
            (Math.min(...childBounds.map((bounds) => bounds.y)) +
              Math.max(
                ...childBounds.map((bounds) => bounds.y + bounds.height),
              )) /
            2,
        }
        const graphCenter = {
          x: graphBounds!.x + graphBounds!.width / 2,
          y: graphBounds!.y + graphBounds!.height / 2,
        }
        await page.mouse.move(graphBounds!.x + 8, graphBounds!.y + 8)
        await page.mouse.down()
        await page.mouse.move(
          graphBounds!.x + 8 + graphCenter.x - childCenter.x,
          graphBounds!.y + 8 + graphCenter.y - childCenter.y,
          { steps: 10 },
        )
        await page.mouse.up()
        await page.locator('.react-flow__controls-zoomin').click()
        await operatorCards.last().scrollIntoViewIfNeeded()
        await capture(`operator-${label.toLowerCase()}`)
      }

      await page.goto('/')
      await page
        .getByRole('textbox', { name: 'Your prompt' })
        .fill(
          'I want to test whether my neighborhood can support a bakery that helps busy families.',
        )
      await submitPrompt(page, testInfo.project.name !== 'mobile')
      await expect(page.getByTestId('graph-node-idea').first()).toBeVisible()
      await capture('initial-graph')

      await page.getByTestId('graph-node-idea').first().click()
      await expect(page.getByTestId('inspector-panel')).toBeVisible()
      for (const section of [
        page.locator('.steering-actions'),
        page.locator('.operator-options'),
      ]) {
        expect(
          parseFloat(
            await section.evaluate(
              (element) => getComputedStyle(element).paddingLeft,
            ),
          ),
        ).toBeGreaterThan(0)
        await expect(section).toHaveCSS('border-style', 'solid')
      }
      const cardBadges = await page
        .getByTestId('graph-node-idea')
        .first()
        .locator('.graph-card-badges')
        .allTextContents()
      expect(cardBadges.join(' ')).not.toMatch(/visible/i)
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
      const visibleNodes = page.locator('.react-flow__node:visible')
      const visibleNodeBounds = await Promise.all(
        Array.from({ length: await visibleNodes.count() }, (_, index) =>
          visibleNodes.nth(index).boundingBox(),
        ),
      )
      for (
        let leftIndex = 0;
        leftIndex < visibleNodeBounds.length;
        leftIndex += 1
      ) {
        const left = visibleNodeBounds[leftIndex]
        expect(left).not.toBeNull()
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < visibleNodeBounds.length;
          rightIndex += 1
        ) {
          const right = visibleNodeBounds[rightIndex]
          expect(right).not.toBeNull()
          const intersects =
            left!.x < right!.x + right!.width &&
            left!.x + left!.width > right!.x &&
            left!.y < right!.y + right!.height &&
            left!.y + left!.height > right!.y
          expect(intersects).toBe(false)
        }
      }

      await page.getByLabel('Mock scenario').selectOption('none-pass')
      const nonePassNodeCount = await page
        .getByTestId('graph-node-idea')
        .count()
      const nonePassEdgeCount = await page.locator('.react-flow__edge').count()
      await page.getByRole('button', { name: /^Ground/i }).click()
      await expect(
        page.getByText('No candidates met the quality bar; nothing was added.'),
      ).toBeVisible()
      expect(
        parseFloat(
          await page
            .getByRole('status')
            .filter({
              hasText: 'No candidates met the quality bar; nothing was added.',
            })
            .evaluate((element) => getComputedStyle(element).paddingTop),
        ),
      ).toBeGreaterThan(0)
      await expect(page.getByTestId('graph-node-idea')).toHaveCount(
        nonePassNodeCount,
      )
      await expect(page.locator('.react-flow__edge')).toHaveCount(
        nonePassEdgeCount,
      )
      await page.locator('.operator-options').scrollIntoViewIfNeeded()
      await capture('operator-none-pass-empty-state')

      const parentIdeaCount = await page.getByTestId('graph-node-idea').count()
      const parentEdgeCount = await page.locator('.react-flow__edge').count()
      await page.getByRole('button', { name: 'Reject', exact: true }).click()
      const hiddenPlaceholder = page.getByTestId('graph-node-hidden')
      await expect(hiddenPlaceholder).toBeVisible()
      await expect(hiddenPlaceholder).toHaveAttribute(
        'aria-label',
        'Hidden direction · rejected',
      )
      await expect(page.getByTestId('inspector-panel')).toHaveCount(0)
      await expect(page.getByTestId('graph-node-idea')).toHaveCount(
        parentIdeaCount - 1,
      )
      await expect(page.locator('.direction-count')).toHaveText(
        `${parentIdeaCount - 1} directions`,
      )
      await expect(page.locator('.react-flow__edge')).toHaveCount(
        parentEdgeCount,
      )
      await hiddenPlaceholder.scrollIntoViewIfNeeded()
      await capture('hidden-parent-placeholder')
      await page
        .getByRole('button', { name: 'Reveal rejected and archived' })
        .click()
      await expect(page.getByTestId('graph-node-hidden')).toHaveCount(0)
      await expect(page.locator('.graph-card.status-rejected')).toBeVisible()
      const revealedParent = page.locator('.graph-card.status-rejected')
      await expect(
        revealedParent.getByText('Rejected', { exact: true }),
      ).toBeVisible()
      expect(
        await revealedParent.evaluate(
          (element) => getComputedStyle(element).borderStyle,
        ),
      ).toBe('dashed')
      expect(
        Number(
          await revealedParent
            .locator('.graph-card-title')
            .evaluate((element) => getComputedStyle(element).opacity),
        ),
      ).toBeLessThan(1)
      await expect(page.getByTestId('graph-node-idea')).toHaveCount(
        parentIdeaCount,
      )
      await revealedParent.scrollIntoViewIfNeeded()
      await capture('hidden-parent-revealed')
      await page
        .getByRole('button', { name: 'Hide rejected and archived' })
        .click()
      await expect(page.getByTestId('graph-node-hidden')).toBeVisible()
      const hiddenIdeaCount = parentIdeaCount - 1
      const hiddenEdgeCount = await page.locator('.react-flow__edge').count()
      await page.reload()
      await expect(page.getByTestId('graph-node-hidden')).toBeVisible()
      await expect(page.getByTestId('graph-node-idea')).toHaveCount(
        hiddenIdeaCount,
      )
      await expect(page.locator('.react-flow__edge')).toHaveCount(
        hiddenEdgeCount,
      )
      await page.getByTestId('graph-node-hidden').scrollIntoViewIfNeeded()
      await capture('hidden-parent-placeholder-reload')

      await page
        .getByRole('textbox', { name: 'Your prompt' })
        .fill('I want to test a neighborhood bakery with a new model.')
      await page.getByLabel('Mock scenario').selectOption('operator-gaps')
      await submitPrompt(page, testInfo.project.name !== 'mobile')
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
      await page.locator('.operator-options').scrollIntoViewIfNeeded()
      await capture('operator-gaps-disabled-reasons')

      const changedAssumptionsField = page.getByRole('textbox', {
        name: 'Changed assumptions',
        exact: true,
      })
      await expect(changedAssumptionsField).toBeVisible()
      await changedAssumptionsField.fill(
        'Nearby parents will preorder breakfast boxes weekly',
      )
      await page.getByRole('button', { name: 'Save edits' }).click()
      await expect(page.getByRole('button', { name: /^Invert/i })).toBeEnabled()
      await page.locator('.operator-options').scrollIntoViewIfNeeded()
      await capture('operator-gaps-invert-enabled')

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
