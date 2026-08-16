-- Project-local LazyVim plugin spec (loaded automatically by lazy.nvim when you
-- open Neovim in this project and mark the directory as trusted on first load).

-- Captured while this file loads, i.e. with cwd at the project root. Used below
-- to scope the overseer templates to this project only.
local root = vim.fn.getcwd()

--------------------------------------------------------------------------------
-- Custom overseer "run" templates, modelled on the entries in
--   ~/Code/plugins/quickfail.nvim/lua/quickfail/shell_cmds.lua
--
-- Each entry becomes a template shown in :OverseerRun (<leader>oo). `cmd` is a
-- function returning either:
--   * a string   -> run through the shell (supports &&, pipes, redirection), or
--   * a string[] -> executed directly as argv (no shell).
-- Expand `%`, `%:p`, `%:t:r`, ... yourself with vim.fn.expand, exactly like
-- quickfail does.
--------------------------------------------------------------------------------
local overseer_examples = {
  -- static argv, no shell (cf. M.entries.precommit)
  {
    name = "pre-commit",
    desc = "Run all pre-commit hooks over all files",
    cmd = function()
      return { "pre-commit", "run", "-a" }
    end,
  },

  -- shell string so `&&` works (cf. M.functions.test_cmd + amp_concat)
  {
    name = "test",
    desc = "echo hello && echo world",
    cmd = function()
      return "echo hello && echo world"
    end,
  },

  -- filetype-scoped + expands the current file (cf. M.entries.python)
  {
    name = "python",
    desc = "Run the current file with python3",
    filetype = "python",
    cmd = function()
      return { "python3", vim.fn.expand("%:p") }
    end,
  },

  -- run a just recipe (cf. M.entries.just)
  {
    name = "just",
    desc = "Run a just recipe from the current file",
    filetype = "just",
    cmd = function()
      return { "just", "--justfile", vim.fn.expand("%:p") }
    end,
  },

  -- shell builtin needs a shell string (cf. M.entries.source)
  {
    name = "source",
    desc = "source %:p in the shell",
    cmd = function()
      return "source " .. vim.fn.expand("%:p")
    end,
  },

  -- filetype-scoped nix eval (cf. M.entries["nix-eval"] / ["nix-instantiate"])
  {
    name = "nix-eval",
    desc = "nix eval --file %  (variant: nix-instantiate --eval %)",
    filetype = "nix",
    cmd = function()
      return { "nix", "eval", "--file", vim.fn.expand("%:p") }
    end,
  },

  -- computed command with a guard (cf. M.functions.quadlet_iterate).
  -- overseer conditions only support filetype/dir, so the .container/.pod guard
  -- lives in the builder: on a non-quadlet file it returns a harmless notice.
  {
    name = "quadlet",
    desc = "daemon-reload + verify + restart + journal for a .container/.pod unit",
    cmd = function()
      local ext = vim.fn.expand("%:e"):lower()
      if ext ~= "container" and ext ~= "pod" then
        return { "echo", "not a .container/.pod quadlet file" }
      end
      local unit = vim.fn.expand("%:t:r") .. ".service"
      return table.concat({
        "systemctl --user daemon-reload",
        "systemd-analyze --user --generators=true verify " .. unit,
        "systemctl --user restart " .. unit,
        "journalctl --user -xeu " .. unit,
      }, " && ")
    end,
  },
}

return {
  -- Drive this repo's devcontainer from host Neovim.
  -- Requires (host): Neovim nightly, the `devcontainer` CLI, and podman.
  {
    "jedrzejboczar/devcontainers.nvim",
    cmd = { "DevcontainersUp", "DevcontainersExec" },
    opts = {
      docker_cmd = "podman", -- rootless podman instead of docker
    },
    keys = {
      { "<leader>Du", "<cmd>DevcontainersUp<cr>", desc = "Devcontainer: up" },
      { "<leader>De", ":DevcontainersExec ", desc = "Devcontainer: exec (type a command)" },
    },
  },

  -- Extend the *already-enabled* overseer LazyExtra with project-local templates.
  -- `optional = true` => this fragment applies only if overseer is enabled
  -- elsewhere; it never installs overseer. No keymaps or setup() config here —
  -- the opts function is used solely to register templates when overseer loads.
  {
    "stevearc/overseer.nvim",
    optional = true,
    opts = function(_, opts)
      local overseer = require("overseer")
      for _, e in ipairs(overseer_examples) do
        overseer.register_template({
          name = e.name,
          desc = e.desc,
          -- scope to this project (+ filetype when set)
          condition = { dir = root, filetype = e.filetype },
          builder = function()
            return { name = e.name, cmd = e.cmd() }
          end,
        })
      end
      return opts
    end,
  },
}
