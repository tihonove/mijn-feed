export function LoginPage({ google }: { google: boolean }) {
    return (
        <main className="login">
            <h1>Mijn Feed</h1>
            <p>Личная лента: голландский с повторами, новости и факты вперемешку.</p>
            {google ? (
                <a className="btn" href="/auth/google">
                    Войти через Google
                </a>
            ) : (
                <>
                    <a className="btn" href="/auth/dev">
                        Войти (dev)
                    </a>
                    <p>Вход через Google появится, когда на сервере будет задан client ID.</p>
                </>
            )}
        </main>
    );
}
