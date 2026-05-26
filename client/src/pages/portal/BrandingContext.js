import { createContext, useContext } from 'react'

export const BrandingContext = createContext({
  brand_name: 'Help Centre',
  logo_url: null,
  primary_color: '#4F46E5',
  nav_bg: '#FFFFFF',
  nav_text: '#111827',
  nav_active_bg: '#EEF2FF',
  nav_active_text: '#4F46E5',
  page_bg: '#F8F9FB',
  button_bg: '#4F46E5',
  button_text: '#FFFFFF',
  login_title: 'Welcome to the Help Centre',
  login_subtitle: 'Sign in with your work email address',
  footer_text: null,
})

export const useBranding = () => useContext(BrandingContext)
