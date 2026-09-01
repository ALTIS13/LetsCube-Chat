import { useEffect, type ReactNode } from "react";
import { KubIcon } from "@/components/kub";
import {
  BOT_API_AUTHORIZATION,
  BOT_API_BASE_URL,
  BOT_API_EXAMPLES,
  BOT_API_METHOD_GROUPS,
  BOT_CALLBACK_EXAMPLE,
  BOT_COMMANDS_EXAMPLE,
  BOT_ERROR_EXAMPLE,
  BOT_SUCCESS_EXAMPLE,
  BOT_UPDATE_EXAMPLE,
} from "@/content/botApiDocs";
import { PublicPageShell } from "./PublicPageShell";

const NAVIGATION = [
  { id: "quick-start", label: "Быстрый старт" },
  { id: "methods", label: "Методы" },
  { id: "commands-buttons", label: "Команды и кнопки" },
  { id: "updates-webhooks", label: "Обновления и webhooks" },
  { id: "reliability", label: "Надежная интеграция" },
] as const;

export function BotDocsPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Bot API — LETSCUBE";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <PublicPageShell>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="border-b border-[color:var(--kub-border-color)] pb-8">
          <div className="flex max-w-4xl items-start gap-4">
            <span className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] text-[color:var(--kub-cyan)]">
              <KubIcon name="bot" size={22} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--kub-pink)]">
                Документация для разработчиков
              </p>
              <h1 className="mt-2 text-3xl font-bold leading-tight text-[color:var(--kub-text)] sm:text-4xl">
                LETSCUBE Bot API
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--kub-muted)] sm:text-base">
                Версионированный HTTP API для ботов в личных и групповых чатах LETSCUBE.
                Все методы принимают JSON через POST и возвращают единый JSON-ответ.
              </p>
            </div>
          </div>

          <dl className="mt-6 grid gap-px overflow-hidden rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-border-color)] md:grid-cols-2">
            <EndpointMeta label="Базовый URL" value={BOT_API_BASE_URL} />
            <EndpointMeta label="Авторизация" value={BOT_API_AUTHORIZATION} />
          </dl>

          <div className="mt-5 flex gap-3 rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] p-4 text-sm leading-6 text-[color:var(--kub-muted)]">
            <KubIcon name="info" size={18} className="mt-0.5 shrink-0 text-[color:var(--kub-cyan)]" />
            <p>
              Концепции знакомы разработчикам Telegram-ботов, но LETSCUBE не заявляет
              протокольную совместимость. Используйте описанные здесь URL, поля и правила
              доставки, а не Telegram SDK без адаптера.
            </p>
          </div>
        </header>

        <div className="grid gap-10 py-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <nav aria-label="Разделы Bot API">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
                Содержание
              </p>
              <ol className="border-l border-[color:var(--kub-border-color)]">
                {NAVIGATION.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block border-l-2 border-transparent py-2 pl-3 text-sm text-[color:var(--kub-muted)] transition-colors hover:border-[color:var(--kub-cyan)] hover:text-[color:var(--kub-text)]"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <article className="min-w-0">
            <DocSection id="quick-start" title="Быстрый старт">
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberedStep number="1" title="Получите токен">
                  Создайте бота в разделе «Мои боты». Полный токен показывается один раз.
                </NumberedStep>
                <NumberedStep number="2" title="Храните на сервере">
                  Передавайте токен через секреты среды. Не помещайте его в URL, браузерный код
                  или логи.
                </NumberedStep>
                <NumberedStep number="3" title="Вызовите метод">
                  Выполните POST к базовому URL и передайте пустой объект для getMe.
                </NumberedStep>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <CodeBlock title="Успешный ответ" code={BOT_SUCCESS_EXAMPLE} />
                <CodeBlock title="Ошибка и лимит" code={BOT_ERROR_EXAMPLE} />
              </div>
              <p className="mt-4 text-sm leading-7 text-[color:var(--kub-muted)]">
                При ротации новый токен показывается один раз, а прежний сразу перестает
                действовать. Отзыв токена не удаляет бота или историю чатов. Никогда не
                передавайте токен в query string и не сохраняйте его в localStorage.
              </p>

              <div data-testid="bot-docs-examples" className="mt-7 space-y-5">
                {BOT_API_EXAMPLES.map((example) => (
                  <CodeBlock
                    key={example.language}
                    title={example.language}
                    code={example.code}
                  />
                ))}
              </div>
            </DocSection>

            <DocSection id="methods" title="Методы">
              <p className="text-sm leading-7 text-[color:var(--kub-muted)]">
                Неизвестные поля отклоняются. Идентификаторы чатов, сообщений и callback-запросов
                имеют формат UUID. Изменяющие состояние методы требуют idempotency_key длиной
                8–128 символов.
              </p>
              <div className="mt-6 space-y-7">
                {BOT_API_METHOD_GROUPS.map((group) => (
                  <section key={group.title} aria-labelledby={`method-${group.title}`}>
                    <h3
                      id={`method-${group.title}`}
                      className="text-base font-bold text-[color:var(--kub-text)]"
                    >
                      {group.title}
                    </h3>
                    <div className="mt-2 divide-y divide-[color:var(--kub-border-color)] border-y border-[color:var(--kub-border-color)]">
                      {group.methods.map((method) => (
                        <div
                          key={method.name}
                          className="grid gap-2 py-3 text-sm sm:grid-cols-[210px_minmax(0,1fr)] sm:gap-5"
                        >
                          <code className="break-words font-semibold text-[color:var(--kub-cyan)]">
                            {method.name}
                          </code>
                          <div className="min-w-0">
                            <p className="leading-6 text-[color:var(--kub-text)]">
                              {method.summary}
                            </p>
                            <p className="mt-1 break-words font-mono text-xs leading-5 text-[color:var(--kub-muted)]">
                              {method.input}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </DocSection>

            <DocSection id="commands-buttons" title="Команды и кнопки">
              <p className="text-sm leading-7 text-[color:var(--kub-muted)]">
                Команды состоят из строчных латинских букв, цифр и подчеркивания, начинаются с
                буквы и содержат до 32 символов. Callback-кнопка возвращает callback_query;
                подтвердите обработку методом answerCallbackQuery.
              </p>
              <div className="mt-5 grid gap-5 xl:grid-cols-2">
                <CodeBlock title="setMyCommands" code={BOT_COMMANDS_EXAMPLE} />
                <CodeBlock title="sendMessage с кнопками" code={BOT_CALLBACK_EXAMPLE} />
              </div>
            </DocSection>

            <DocSection id="updates-webhooks" title="Обновления и webhooks">
              <div className="space-y-4 text-sm leading-7 text-[color:var(--kub-muted)]">
                <p>
                  Webhook и getUpdates взаимоисключающие. Long polling ограничен 30 секундами и
                  возвращает message, edited_message, callback_query и membership. Неполученные
                  обновления хранятся до 24 часов.
                </p>
                <p>
                  Доставка выполняется как минимум один раз. Сохраняйте последний обработанный
                  update_id и дедуплицируйте обновления до выполнения побочного эффекта. Для
                  getUpdates передавайте следующий offset после успешной обработки.
                </p>
                <p>
                  Webhook URL обязан использовать HTTPS и не может содержать учетные данные,
                  IP-адрес или ссылаться на loopback, private, link-local и metadata сети. При
                  доставке LETSCUBE передает secret_token в заголовке
                  <code className="mx-1 break-all text-[color:var(--kub-cyan)]">
                    X-Letscube-Bot-Webhook-Secret
                  </code>
                  . Сравнивайте его постоянным по времени сравнением до чтения тела запроса.
                </p>
              </div>
              <div className="mt-5">
                <CodeBlock title="Форма обновления" code={BOT_UPDATE_EXAMPLE} />
              </div>

              <div className="mt-6 border-l-2 border-[color:var(--kub-pink)] pl-4">
                <h3 className="font-bold text-[color:var(--kub-text)]">Групповая приватность</h3>
                <p className="mt-2 text-sm leading-7 text-[color:var(--kub-muted)]">
                  По умолчанию включена групповая приватность: бот получает адресованные ему
                  команды, упоминания, ответы на его сообщения, callback-события и собственные
                  события членства. Полный поток новых сообщений требует запроса владельца бота
                  и отдельного одобрения администратора группы; история до вступления недоступна.
                </p>
              </div>
            </DocSection>

            <DocSection id="reliability" title="Надежная интеграция">
              <dl className="divide-y divide-[color:var(--kub-border-color)] border-y border-[color:var(--kub-border-color)] text-sm">
                <GuidanceRow
                  term="Идемпотентность"
                  description="Повторяйте изменяющий запрос с тем же idempotency_key и неизменным телом. Новый ключ означает новую операцию."
                />
                <GuidanceRow
                  term="Повторные запросы"
                  description="Для 429 ждите retry_after секунд. Для 5xx применяйте ограниченный exponential backoff с jitter; постоянные 4xx не повторяйте."
                />
                <GuidanceRow
                  term="Лимиты"
                  description="Ограничения независимы для токена, метода, чата и получателя. Не создавайте параллельный всплеск после паузы."
                />
                <GuidanceRow
                  term="Webhook retries"
                  description="Неуспешная доставка повторяется с ограниченным backoff. После потолка попыток событие уходит в dead letter и отражается в безопасной диагностике."
                />
                <GuidanceRow
                  term="Защита данных"
                  description="Обновления не содержат телефоны, email, внутренние роли или произвольные профильные поля. Короткоживущие file URL нельзя переиспользовать как постоянные ссылки."
                />
              </dl>
            </DocSection>
          </article>
        </div>
      </main>
    </PublicPageShell>
  );
}

function EndpointMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-[var(--kub-surface)] px-4 py-3">
      <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--kub-muted)]">
        {label}
      </dt>
      <dd className="mt-1 break-all font-mono text-sm font-semibold text-[color:var(--kub-text)]">
        {value}
      </dd>
    </div>
  );
}

function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-b border-[color:var(--kub-border-color)] py-9 first:pt-0 last:border-b-0"
    >
      <h2 className="text-2xl font-bold leading-tight text-[color:var(--kub-text)]">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function NumberedStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t-2 border-[color:var(--kub-cyan)] bg-[var(--kub-surface)] p-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-bold text-[color:var(--kub-pink)]">{number}</span>
        <h3 className="text-sm font-bold text-[color:var(--kub-text)]">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-6 text-[color:var(--kub-muted)]">{children}</p>
    </div>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)]">
      <h3 className="border-b border-[color:var(--kub-border-color)] px-4 py-2.5 text-xs font-bold text-[color:var(--kub-text)]">
        {title}
      </h3>
      <pre className="max-w-full overflow-x-auto bg-[var(--kub-surface-2)] p-4 text-xs leading-6 text-[color:var(--kub-muted)]">
        <code>{code}</code>
      </pre>
    </section>
  );
}

function GuidanceRow({ term, description }: { term: string; description: string }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-5">
      <dt className="font-semibold text-[color:var(--kub-text)]">{term}</dt>
      <dd className="leading-6 text-[color:var(--kub-muted)]">{description}</dd>
    </div>
  );
}
