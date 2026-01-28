-- Web UI design tokens extracted from Web/public/styles/app.css :root.
-- Update these values to match Web UI precisely when visual tuning.

local tokens = {
  colors = {
    bg = '#1a1c1f', -- main app background
    panel = '#2a2d31', -- card/panel surface
    panel_alt = '#22252a', -- secondary surface
    border = '#3a3f46', -- neutral border
    text = '#e6e6e6', -- primary text
    muted = '#a8a8a8', -- secondary text
    accent = '#3b78ff', -- primary action
    danger = '#ff3b3b', -- destructive
    warning = '#ff9b3b', -- warning
    success = '#48ff83', -- success
    slot = '#343a43', -- slot background
    window_top = '#2b2f34', -- plugin window gradient (top)
    window_bottom = '#15171a', -- plugin window gradient (bottom)
    topbar_top = '#3a4046', -- plugin header gradient (top)
    topbar_bottom = '#272b30', -- plugin header gradient (bottom)
    window_border = '#ffffff', -- window border (use with low alpha)
    topbar_border = '#ffffff', -- header divider (use with low alpha)
    child_tint = { 80, 90, 110, 0.25 }, -- overlay tint
  },
  metrics = {
    topbar_h = 42,
    control_h = 28,
    control_w = 30,
    control_radius = 8,
    control_font = 12,
    control_pad_x = 10,
    window_round = 14,
    border_size = 1,
    frame_round = 8,
    child_round = 10,
    popup_round = 10,
    window_pad_x = 10,
    window_pad_y = 10,
    item_space_x = 8,
    item_space_y = 8,
    toolbar_gap = 8,
    card_pad_x = 14,
    card_pad_y = 12,
  },
}

return tokens
