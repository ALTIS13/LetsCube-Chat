import {useState} from "react";
import {KubIcon} from "@/components/kub";
import {UserAvatar} from "@/components/ui/ChatAvatar";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {Command,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList,CommandSeparator} from "@/components/ui/command";
import type {Profile} from "@/types/database";

export type TaskFilterPerson = Pick<Profile,"id"|"full_name"|"username"|"avatar_url">;
export type TaskAssigneeSelection = readonly string[];

interface Props {
  value: TaskAssigneeSelection;
  onChange: (value: TaskAssigneeSelection) => void;
  people: readonly {id:string;label:string;profile:TaskFilterPerson}[];
  currentUser: TaskFilterPerson;
}

const COMMON = [
  {id:"all",label:"Все исполнители",icon:"users"},
  {id:"me",label:"Я",icon:"user"},
  {id:"unassigned",label:"Без исполнителя",icon:"user"},
] as const;

export function TaskAssigneeFilter({value,onChange,people,currentUser}:Props) {
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  const selected=people.filter(person=>value.includes(person.id));
  const avatars=value.length===0?people.slice(0,3):[
    ...(value.includes("me")?[{id:currentUser.id,profile:currentUser}]:[]),
    ...selected.filter(person=>!value.includes("me") || person.id!==currentUser.id),
  ].slice(0,3);
  const label=value.length===0?"Все исполнители":value.length===1
    ? COMMON.find(option=>option.id===value[0])?.label ?? "Исполнители" : "Исполнители";
  const choose=(id:string)=>onChange(id==="all"?[]:value.includes(id)?value.filter(entry=>entry!==id):[...value,id]);
  return <Popover open={open} onOpenChange={(next)=>{setOpen(next);if(next)setQuery("");}}>
    <PopoverTrigger asChild>
      <button id="task-assignee-filter" type="button" aria-label={`Исполнители: ${value.length?`выбрано ${value.length}`:"все"}`}
        className="inline-flex h-10 pointer-coarse:min-h-11 w-full min-w-0 max-w-full items-center gap-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-inset)] px-2.5 text-xs font-medium text-[color:var(--kub-text)] sm:w-64 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]">
        {avatars.length>0 ? <span aria-hidden="true" className="flex shrink-0 -space-x-2">
          {avatars.map(person=><span key={person.id} className="rounded-full border-2 border-[color:var(--kub-inset)] [&>div]:h-5 [&>div]:w-5 [&>div>div]:h-5 [&>div>div]:w-5 [&>div>div]:text-[9px]">
            <UserAvatar user={person.profile} size="sm"/>
          </span>)}
        </span> : <KubIcon name="user" size={16}/>}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <span className="shrink-0 tabular-nums text-[color:var(--kub-muted)]">{value.length || people.length}</span>
        <KubIcon name="chevronDown" size={14} className="shrink-0 text-[color:var(--kub-muted)]"/>
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-0 text-[color:var(--kub-text)] motion-reduce:animate-none">
      <Command>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Найти исполнителя…" aria-label="Найти исполнителя"/>
        <CommandList aria-multiselectable="true" className="max-h-[min(360px,var(--radix-popover-content-available-height))] overscroll-contain p-1">
          <CommandEmpty>Исполнители не найдены</CommandEmpty>
          <CommandGroup>
            {COMMON.map(option=><CommandItem key={option.id} value={option.id} keywords={[option.label]} onSelect={()=>choose(option.id)}
              aria-selected={option.id==="all"?value.length===0:value.includes(option.id)}
              className="min-h-11 cursor-pointer gap-2 rounded-md px-2 text-[color:var(--kub-text)] data-[selected=true]:bg-[var(--kub-inset)] data-[selected=true]:text-[color:var(--kub-text)]">
              {option.id==="me"?<span aria-hidden="true"><UserAvatar user={currentUser} size="sm"/></span>:<KubIcon name={option.icon} size={18}/>}
              <span className="flex-1">{option.label}</span>{(option.id==="all"?value.length===0:value.includes(option.id)) && <KubIcon name="check" size={16}/>}
            </CommandItem>)}
          </CommandGroup>
          <CommandSeparator/>
          <CommandGroup heading={`Исполнители · ${people.length}`}>
            {people.map(person=><CommandItem key={person.id} value={person.id} keywords={[person.label,person.profile.username??""]}
              aria-selected={value.includes(person.id)}
              onSelect={()=>choose(person.id)} className="min-h-11 cursor-pointer gap-2 rounded-md px-2 text-[color:var(--kub-text)] data-[selected=true]:bg-[var(--kub-inset)] data-[selected=true]:text-[color:var(--kub-text)]">
              <span aria-hidden="true" data-testid="task-filter-avatar" className="shrink-0"><UserAvatar user={person.profile} size="sm"/></span>
              <span className="min-w-0 flex-1 truncate">{person.label}</span>
              {value.includes(person.id) && <KubIcon name="check" size={16}/>}
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
        <div className="flex min-h-11 items-center justify-between gap-2 border-t border-[color:var(--kub-rule)] px-3 text-xs text-[color:var(--kub-muted)]">
          <span role="status">Выбрано: {value.length}</span>
          <button type="button" disabled={value.length===0} onClick={()=>onChange([])}
            className="min-h-11 rounded-md px-2 text-[color:var(--kub-accent-text)] disabled:text-[color:var(--kub-muted)] focus-visible:outline-2 focus-visible:outline-[color:var(--kub-cyan)]">
            Сбросить выбор
          </button>
        </div>
      </Command>
    </PopoverContent>
  </Popover>;
}
