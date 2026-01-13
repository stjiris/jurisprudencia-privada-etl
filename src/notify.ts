import { createTransport } from "nodemailer";

export type Report = {
    target: string,
    dateStart: Date,
    created: number,
    updated: number,
    deleted: number, // On full update might be nice to check if all dgsi we have are still on dgsi
    dateEnd: Date,
}

export function envOrFail(name: string) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing environment variable ${name}`);
    return value;
}

export function getMailConfig() {
    return {
        host: envOrFail("MAIL_HOST"),
        user: envOrFail("MAIL_USER"),
        pass: envOrFail("MAIL_PASS"),
        from: envOrFail("MAIL_FROM"),
        to: envOrFail("MAIL_TO").split(",")
    }
}

export function notify(report: Report) {
    let config: ReturnType<typeof getMailConfig>;
    try {
        config = getMailConfig();
    }
    catch (e) {
        console.error(e);
        return;
    }
    let transporter = createTransport({
        host: config.host,
        secure: true,
        auth: {
            user: config.user,
            pass: config.pass
        }
    });

    // send mail with defined transport object
    transporter.sendMail({
        from: config.from,
        to: config.to,
        subject: `Relatório de atualização da "${report.target}"`,
        html: `
<p>Relatório de atualização da "${report.target}" em modo <b>${"completo"}</b>.
Iniciado em ${report.dateStart.toISOString()} e terminado em ${report.dateEnd.toISOString()} (duração: ${report.dateEnd.getTime() - report.dateStart.getTime()}ms).</p>
<table>
    <tr>
        <th>Operação</th>
        <th>Quantidade</th>
    </tr>
    <tr>
        <td>Criados</td>
        <td>${report.created}</td>
    </tr>
    <tr>
        <td>Atualizados</td>
        <td>${report.updated}</td>
    </tr>
    <tr>
        <td>Eliminados</td>
        <td>${report.deleted}</td>
    </tr>
</table>
`   }, (err, info) => {
        if (err) {
            console.error(config)
            console.error(err);
        }
        else {
            console.error(info);
        }
    });
}
