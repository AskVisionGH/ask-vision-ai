/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_URL = 'https://askvision.ai'

interface WelcomeEmailProps {
  name?: string
}

const WelcomeEmail = ({ name }: WelcomeEmailProps) => {
  const greeting = name ? `Welcome, ${name}` : 'Welcome to Vision'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your AI agent for Solana is ready</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={brandRow}>
            <Text style={brand}>
              Vision<span style={brandItalic}>.</span>
            </Text>
          </Section>

          <Section style={card}>
            <Heading style={h1}>
              {greeting}
              <span style={italic}> .</span>
            </Heading>
            <Text style={text}>
              Vision is your AI co-pilot for Solana — chat in plain English and
              get real-time market intel, on-chain moves, and one-tap swaps.
              Here's a quick tour of what you can do today.
            </Text>

            <Hr style={divider} />

            <Section style={featureRow}>
              <Text style={featureTitle}>
                <span style={featureBullet}>◆</span> Chat with the market
              </Text>
              <Text style={featureBody}>
                Ask anything — token deep-dives, trending mints, smart-money
                flow, sentiment, risk reports. Voice input works too.
              </Text>
            </Section>

            <Section style={featureRow}>
              <Text style={featureTitle}>
                <span style={featureBullet}>◆</span> Swap and send, instantly
              </Text>
              <Text style={featureBody}>
                Quote and execute Jupiter swaps or transfer SOL and SPL tokens
                straight from chat — no DEX hopping.
              </Text>
            </Section>

            <Section style={featureRow}>
              <Text style={featureTitle}>
                <span style={featureBullet}>◆</span> Track smart wallets
              </Text>
              <Text style={featureBody}>
                Watch top traders, early buyers, and PnL leaders. Get the
                signal, skip the noise.
              </Text>
            </Section>

            <Hr style={divider} />

            <Heading style={h2}>
              Connect a <span style={italic}>wallet</span> to unlock everything
            </Heading>
            <Text style={text}>
              Linking your Solana wallet powers personalized PnL, portfolio
              insight, and one-tap trading. It takes ten seconds.
            </Text>

            <Section style={buttonWrap}>
              <Button style={button} href={`${SITE_URL}/chat`}>
                Connect your wallet
              </Button>
            </Section>

            <Text style={muted}>
              Prefer to explore first? Just open Vision and start chatting —
              you can connect any time from settings.
            </Text>
          </Section>

          <Text style={footer}>
            Vision — your AI agent for Solana.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeEmail,
  subject: 'Welcome to Vision — your AI agent for Solana',
  displayName: 'Welcome to Vision',
  previewData: { name: 'Alex' },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  margin: 0,
  padding: '40px 0',
}
const container = { maxWidth: '560px', margin: '0 auto', padding: '0 24px' }
const brandRow = { padding: '0 0 24px' }
const brand = {
  fontSize: '20px',
  fontWeight: 600 as const,
  color: '#09090b',
  letterSpacing: '-0.01em',
  margin: 0,
}
const brandItalic = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: 'italic' as const,
  color: '#8b5cf6',
}
const card = {
  border: '1px solid #ececf0',
  borderRadius: '14px',
  padding: '32px 28px',
  background: '#ffffff',
}
const h1 = {
  fontSize: '28px',
  fontWeight: 600 as const,
  color: '#09090b',
  letterSpacing: '-0.02em',
  margin: '0 0 16px',
  lineHeight: '1.2',
}
const h2 = {
  fontSize: '20px',
  fontWeight: 600 as const,
  color: '#09090b',
  letterSpacing: '-0.01em',
  margin: '4px 0 12px',
  lineHeight: '1.3',
}
const italic = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: 'italic' as const,
  fontWeight: 400 as const,
  color: '#8b5cf6',
}
const text = {
  fontSize: '15px',
  color: '#52525b',
  lineHeight: '1.6',
  margin: '0 0 20px',
}
const divider = {
  border: 'none',
  borderTop: '1px solid #ececf0',
  margin: '8px 0 20px',
}
const featureRow = { margin: '0 0 18px' }
const featureTitle = {
  fontSize: '15px',
  fontWeight: 600 as const,
  color: '#09090b',
  margin: '0 0 4px',
}
const featureBullet = {
  color: '#8b5cf6',
  marginRight: '8px',
}
const featureBody = {
  fontSize: '14px',
  color: '#52525b',
  lineHeight: '1.55',
  margin: 0,
}
const buttonWrap = { padding: '4px 0 20px' }
const button = {
  backgroundColor: '#8b5cf6',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600 as const,
  borderRadius: '12px',
  padding: '12px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}
const muted = {
  fontSize: '13px',
  color: '#a1a1aa',
  lineHeight: '1.5',
  margin: 0,
}
const footer = {
  fontSize: '12px',
  color: '#a1a1aa',
  textAlign: 'center' as const,
  margin: '24px 0 0',
}
