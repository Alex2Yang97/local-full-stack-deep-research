"use client"

import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface CollapsibleProps {
  children: React.ReactNode
  trigger: React.ReactNode
  defaultOpen?: boolean
  className?: string
}

export function Collapsible({ children, trigger, defaultOpen = false, className }: CollapsibleProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="flex items-center cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 mr-2 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 mr-2 text-muted-foreground" />
        )}
        {trigger}
      </div>
      {isOpen && (
        <div className="pl-6 animate-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  )
} 